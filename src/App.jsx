import React, { useState } from 'react';
import ScannerModal from './components/ScannerModal';
import styles from './styles.module.css';

function App() {
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scanData, setScanData] = useState(null);

  const handleScan = (data) => {
    console.log("Datos escaneados:", data);
    setScanData(data);
  };

  return (
    <div className={styles.formContainer}>
      <h1>Escáner de Cédulas Colombianas</h1>
      
      <button 
        className={styles.scanBtn}
        onClick={() => setIsScannerOpen(true)}
      >
        📸 Escanear Cédula
      </button>

      {scanData && (
        <div style={{background: '#f0f9ff', padding: '20px', borderRadius: '10px', marginTop: '20px'}}>
          <h3>Datos Obtenidos:</h3>
          <div className={styles.inputGroup}>
            <label>Tipo de Escaneo</label>
            <input readOnly value={scanData.tipo} />
          </div>
          <div className={styles.inputGroup}>
            <label>Cédula</label>
            <input readOnly value={scanData.cedula || scanData.codigo} />
          </div>
          {scanData.apellidos && (
            <div className={styles.inputGroup}>
              <label>Apellidos</label>
              <input readOnly value={scanData.apellidos} />
            </div>
          )}
          {scanData.nombres && (
            <div className={styles.inputGroup}>
              <label>Nombres</label>
              <input readOnly value={scanData.nombres} />
            </div>
          )}
        </div>
      )}

      <div style={{marginTop: '30px', fontSize: '0.9rem', color: '#666'}}>
        <h4>Instrucciones para pruebas:</h4>
        <ol style={{paddingLeft: '20px'}}>
          <li>Haz clic en "Escanear Cédula"</li>
          <li>Permite el acceso a la cámara</li>
          <li>Apunta al código de barras de la cédula</li>
          <li>Prueba los 3 modos: Cámara, Físico y Subir foto</li>
        </ol>
      </div>

      <ScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScan={handleScan}
      />
    </div>
  );
}

export default App;