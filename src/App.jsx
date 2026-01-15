import React, { useState } from 'react';
import ScannerModal from './components/ScannerModal';
import './styles.module.css';

function App() {
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scanData, setScanData] = useState(null);
  const [scanHistory, setScanHistory] = useState([]);

  const handleScan = (data) => {
    console.log('📱 Datos escaneados:', data);
    setScanData(data);
    
    // Agregar al historial
    setScanHistory(prev => [{
      ...data,
      timestamp: new Date().toLocaleTimeString(),
      id: Date.now()
    }, ...prev.slice(0, 4)]);
    
    // Cerrar scanner automáticamente
    setIsScannerOpen(false);
  };

  return (
    <div className="formContainer">
      <h1>🪪 Escáner de Cédulas</h1>
      <p style={{ textAlign: 'center', marginBottom: '30px', opacity: 0.9 }}>
        Escanea cédulas colombianas con tu celular
      </p>
      
      <button 
        className="scanBtn"
        onClick={() => setIsScannerOpen(true)}
      >
        <span style={{ fontSize: '1.5rem' }}>📸</span>
        ESCANEAR CÉDULA
      </button>
      
      {/* Resultado del escaneo */}
      {scanData && (
        <div style={{
          background: 'rgba(255, 255, 255, 0.1)',
          backdropFilter: 'blur(10px)',
          borderRadius: '15px',
          padding: '20px',
          marginTop: '20px',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          animation: 'fadeIn 0.5s'
        }}>
          <h3 style={{ marginTop: 0, color: '#10b981' }}>
            ✅ Datos obtenidos
          </h3>
          
          <div className="inputGroup">
            <label>Tipo</label>
            <input readOnly value={scanData.tipo} />
          </div>
          
          <div className="inputGroup">
            <label>Cédula</label>
            <input readOnly value={scanData.cedula || scanData.codigo} />
          </div>
          
          {scanData.apellidos && (
            <div className="inputGroup">
              <label>Apellidos</label>
              <input readOnly value={scanData.apellidos} />
            </div>
          )}
          
          {scanData.nombres && scanData.nombres !== "N/A" && (
            <div className="inputGroup">
              <label>Nombres</label>
              <input readOnly value={scanData.nombres} />
            </div>
          )}
          
          <button
            onClick={() => setScanData(null)}
            style={{
              background: 'rgba(239, 68, 68, 0.2)',
              color: '#ef4444',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              padding: '10px 20px',
              borderRadius: '10px',
              marginTop: '15px',
              cursor: 'pointer',
              width: '100%'
            }}
          >
            Limpiar datos
          </button>
        </div>
      )}
      
      {/* Historial */}
      {scanHistory.length > 0 && (
        <div style={{ marginTop: '30px' }}>
          <h4>📋 Historial de escaneos</h4>
          {scanHistory.map(item => (
            <div key={item.id} style={{
              background: 'rgba(255,255,255,0.05)',
              padding: '10px',
              margin: '8px 0',
              borderRadius: '8px',
              borderLeft: '3px solid #3b82f6',
              fontSize: '0.9rem'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 'bold' }}>{item.cedula || item.codigo}</span>
                <span style={{ opacity: 0.7 }}>{item.timestamp}</span>
              </div>
              <div style={{ opacity: 0.8, fontSize: '0.8rem' }}>
                {item.apellidos && `${item.apellidos} ${item.nombres || ''}`}
              </div>
            </div>
          ))}
        </div>
      )}
      
      {/* Instrucciones */}
      <div style={{
        marginTop: '40px',
        background: 'rgba(255,255,255,0.05)',
        padding: '20px',
        borderRadius: '15px',
        fontSize: '0.9rem'
      }}>
        <h4>💡 Instrucciones para Android/Samsung:</h4>
        <ol style={{ paddingLeft: '20px', lineHeight: '1.8' }}>
          <li>Asegúrate de dar <strong>permisos de cámara</strong></li>
          <li>Usa el botón <strong>⚡ Flash</strong> si la iluminación es mala</li>
          <li>Si no enfoca, toca el botón <strong>🔍 Enfoque</strong></li>
          <li>Mantén el celular <strong>horizontal</strong> para mejor lectura</li>
          <li>Acerca la cédula hasta que el código llene el recuadro verde</li>
        </ol>
      </div>
      
      {/* Scanner Modal */}
      <ScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScan={handleScan}
      />
      
      {/* Footer */}
      <div style={{
        textAlign: 'center',
        marginTop: '40px',
        paddingTop: '20px',
        borderTop: '1px solid rgba(255,255,255,0.1)',
        fontSize: '0.8rem',
        opacity: 0.7
      }}>
        <p>Optimizado para Android Samsung</p>
        <p>Versión 2.0 • Cédulas colombianas</p>
      </div>
    </div>
  );
}

export default App;