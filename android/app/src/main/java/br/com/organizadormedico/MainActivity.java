package br.com.organizadormedico;

import com.getcapacitor.BridgeActivity;

// Registra o plugin de salvamento antes de iniciar a ponte do aplicativo Capacitor.
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(NativeDownloadsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
