package com.augrixs.augrant;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.DocumentsContract;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Two jobs: ask for the media permissions (the normal Android dialog), and let the user pick a
 * folder and write exported files into it (Storage Access Framework, no storage permission needed).
 */
@CapacitorPlugin(
    name = "Saf",
    permissions = {
        @Permission(
            alias = "media",
            strings = {
                Manifest.permission.READ_MEDIA_VIDEO,
                Manifest.permission.READ_MEDIA_AUDIO,
                Manifest.permission.READ_MEDIA_IMAGES
            }
        ),
        @Permission(alias = "legacy", strings = { Manifest.permission.READ_EXTERNAL_STORAGE })
    }
)
public class SafPlugin extends Plugin {

    private final Map<String, OutputStream> streams = new HashMap<>();

    private String mediaAlias() {
        return Build.VERSION.SDK_INT >= 33 ? "media" : "legacy";
    }

    private void resolveGranted(PluginCall call, boolean granted) {
        JSObject r = new JSObject();
        r.put("granted", granted);
        call.resolve(r);
    }

    @PluginMethod
    public void requestMedia(PluginCall call) {
        if (getPermissionState(mediaAlias()) == PermissionState.GRANTED) {
            resolveGranted(call, true);
            return;
        }
        requestPermissionForAlias(mediaAlias(), call, "mediaCallback");
    }

    @PermissionCallback
    private void mediaCallback(PluginCall call) {
        resolveGranted(call, getPermissionState(mediaAlias()) == PermissionState.GRANTED);
    }

    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        i.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
        );
        startActivityForResult(call, i, "pickFolderResult");
    }

    @ActivityCallback
    private void pickFolderResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.reject("cancelled");
            return;
        }
        Uri tree = data.getData();
        try {
            getContext()
                .getContentResolver()
                .takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (Exception ignored) {
            // the permission still works for this run
        }
        JSObject r = new JSObject();
        r.put("uri", tree.toString());
        r.put("name", folderName(tree));
        call.resolve(r);
    }

    private String folderName(Uri tree) {
        try {
            Uri doc = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
            try (Cursor c = getContext()
                .getContentResolver()
                .query(doc, new String[] { DocumentsContract.Document.COLUMN_DISPLAY_NAME }, null, null, null)) {
                if (c != null && c.moveToFirst()) return c.getString(0);
            }
        } catch (Exception ignored) {
            // fall through
        }
        return tree.getLastPathSegment() == null ? "folder" : tree.getLastPathSegment();
    }

    @PluginMethod
    public void openFile(PluginCall call) {
        String tree = call.getString("tree");
        String name = call.getString("name");
        String mime = call.getString("mime", "application/octet-stream");
        if (tree == null || name == null) {
            call.reject("missing arguments");
            return;
        }
        try {
            Uri treeUri = Uri.parse(tree);
            Uri parent = DocumentsContract.buildDocumentUriUsingTree(treeUri, DocumentsContract.getTreeDocumentId(treeUri));
            ContentResolver cr = getContext().getContentResolver();
            Uri doc = DocumentsContract.createDocument(cr, parent, mime, name);
            if (doc == null) {
                call.reject("cannot create the file in that folder");
                return;
            }
            OutputStream os = cr.openOutputStream(doc, "w");
            if (os == null) {
                call.reject("cannot open the file for writing");
                return;
            }
            String id = UUID.randomUUID().toString();
            synchronized (streams) {
                streams.put(id, os);
            }
            JSObject r = new JSObject();
            r.put("id", id);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("cannot open the destination: " + e.getMessage());
        }
    }

    @PluginMethod
    public void write(PluginCall call) {
        String id = call.getString("id");
        String data = call.getString("data");
        OutputStream os;
        synchronized (streams) {
            os = id == null ? null : streams.get(id);
        }
        if (os == null || data == null) {
            call.reject("unknown file");
            return;
        }
        try {
            os.write(Base64.decode(data, Base64.DEFAULT));
            call.resolve();
        } catch (Exception e) {
            call.reject("write failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void close(PluginCall call) {
        String id = call.getString("id");
        OutputStream os;
        synchronized (streams) {
            os = id == null ? null : streams.remove(id);
        }
        try {
            if (os != null) {
                os.flush();
                os.close();
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("close failed: " + e.getMessage());
        }
    }
}
