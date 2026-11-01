package com.augrixs.augrant;

import android.net.Uri;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;

/** Sends every <input type="file"> request to MainActivity, which shows the Android "open with" app chooser. */
public class PickerChromeClient extends BridgeWebChromeClient {

    private final MainActivity activity;

    public PickerChromeClient(Bridge bridge, MainActivity activity) {
        super(bridge);
        this.activity = activity;
    }

    @Override
    public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, WebChromeClient.FileChooserParams fileChooserParams) {
        return activity.openPicker(filePathCallback, fileChooserParams);
    }
}
