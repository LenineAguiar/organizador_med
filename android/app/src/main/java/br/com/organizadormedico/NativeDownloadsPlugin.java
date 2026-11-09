package br.com.organizadormedico;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;

@CapacitorPlugin(name = "NativeDownloads")
public class NativeDownloadsPlugin extends Plugin {

    // Abre o seletor de local do Android e preserva os dados até o usuário escolher onde salvar.
    @PluginMethod
    public void saveToDevice(PluginCall call) {
        String fileName = call.getString("name");
        String mimeType = call.getString("mimeType");
        String data = call.getString("data");
        if (fileName == null || fileName.trim().isEmpty() || mimeType == null || data == null) {
            call.reject("Nome, tipo e conteúdo do arquivo são obrigatórios.");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, fileName.replaceAll("[/\\\\]", "_"));
        startActivityForResult(call, intent, "saveResult");
    }

    // Grava os bytes no destino autorizado pelo usuário e informa se o arquivo foi salvo.
    @ActivityCallback
    private void saveResult(PluginCall call, ActivityResult result) {
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject response = new JSObject();
            response.put("saved", false);
            call.resolve(response);
            return;
        }

        Uri destination = result.getData().getData();
        if (destination == null) {
            call.reject("O local escolhido não forneceu um destino para o arquivo.");
            return;
        }

        try {
            byte[] fileData = Base64.decode(call.getString("data"), Base64.DEFAULT);
            try (OutputStream output = getContext().getContentResolver().openOutputStream(destination, "w")) {
                if (output == null) {
                    call.reject("Não foi possível abrir o local escolhido para salvar o arquivo.");
                    return;
                }
                output.write(fileData);
            }
            JSObject response = new JSObject();
            response.put("saved", true);
            response.put("uri", destination.toString());
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Não foi possível salvar o arquivo no local escolhido.", error);
        }
    }
}
