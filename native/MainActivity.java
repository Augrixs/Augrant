package com.augrixs.augrant;

import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.BridgeActivity;
import java.util.ArrayList;

public class MainActivity extends BridgeActivity {

    private ActivityResultLauncher<Intent> pickLauncher;
    private ValueCallback<Uri[]> pending;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SafPlugin.class);
        super.onCreate(savedInstanceState);
        pickLauncher = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
            ValueCallback<Uri[]> cb = pending;
            pending = null;
            if (cb == null) return;
            Uri[] uris = null;
            Intent data = result.getData();
            if (result.getResultCode() == RESULT_OK && data != null) {
                ClipData clip = data.getClipData();
                if (clip != null && clip.getItemCount() > 0) {
                    uris = new Uri[clip.getItemCount()];
                    for (int i = 0; i < clip.getItemCount(); i++) uris[i] = clip.getItemAt(i).getUri();
                } else if (data.getData() != null) {
                    uris = new Uri[] { data.getData() };
                }
            }
            cb.onReceiveValue(uris);
        });
        getBridge().getWebView().setWebChromeClient(new PickerChromeClient(getBridge(), this));
    }

    /** Shows the system chooser (Files, ZArchiver, Gallery, ...) for a file input in the web page. */
    boolean openPicker(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
        if (pending != null) pending.onReceiveValue(null);
        pending = callback;
        ArrayList<String> mimes = new ArrayList<>();
        String[] types = params.getAcceptTypes();
        if (types != null) {
            for (String t : types) {
                if (t == null) continue;
                for (String part : t.split(",")) {
                    String m = part.trim();
                    if (m.contains("/")) mimes.add(m);
                }
            }
        }
        Intent get = new Intent(Intent.ACTION_GET_CONTENT);
        get.addCategory(Intent.CATEGORY_OPENABLE);
        get.setType(mimes.size() == 1 ? mimes.get(0) : "*/*");
        if (mimes.size() > 1) get.putExtra(Intent.EXTRA_MIME_TYPES, mimes.toArray(new String[0]));
        if (params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) get.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        Intent chooser = Intent.createChooser(get, "เลือกไฟล์จากแอป");
        try {
            pickLauncher.launch(chooser);
        } catch (Exception e) {
            pending = null;
            callback.onReceiveValue(null);
        }
        return true;
    }
}
