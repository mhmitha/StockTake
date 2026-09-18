package com.stocktake.app;

import android.annotation.SuppressLint;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.webkit.WebViewAssetLoader;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

public class MainActivity extends android.app.Activity {

    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, @NonNull WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }
        });

        webView.addJavascriptInterface(new NativeBridge(), "AndroidStockTake");
        webView.loadUrl("https://appassets.androidplatform.net/assets/index.html");
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    /** Exposed to the page as window.AndroidStockTake — see app.js exportSpreadsheet(). */
    public class NativeBridge {
        @JavascriptInterface
        public void saveXlsx(String base64Data, String filename) {
            byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
            boolean ok = writeToDownloads(bytes, filename);
            runOnUiThread(() -> Toast.makeText(
                    MainActivity.this,
                    ok ? "Saved to Downloads: " + filename : "Could not save " + filename,
                    Toast.LENGTH_LONG
            ).show());
        }
    }

    private boolean writeToDownloads(byte[] bytes, @Nullable String filename) {
        if (filename == null || filename.isEmpty()) filename = "stocktake.xlsx";
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
                values.put(MediaStore.Downloads.MIME_TYPE,
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
                values.put(MediaStore.Downloads.IS_PENDING, 1);
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) return false;
                try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                    if (out == null) return false;
                    out.write(bytes);
                }
                values.clear();
                values.put(MediaStore.Downloads.IS_PENDING, 0);
                getContentResolver().update(uri, values, null, null);
            } else {
                File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (!dir.exists() && !dir.mkdirs()) return false;
                File file = new File(dir, filename);
                try (FileOutputStream out = new FileOutputStream(file)) {
                    out.write(bytes);
                }
            }
            return true;
        } catch (IOException e) {
            return false;
        }
    }
}
