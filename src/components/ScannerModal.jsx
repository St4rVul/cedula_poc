import React, { useState, useEffect, useRef, useCallback } from "react";
import { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } from "@zxing/library";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { 
  faTimes, faBolt, faCamera, faBarcode, 
  faUpload, faFile, faSyncAlt, faExclamationTriangle,
  faCheckCircle, faExpand, faCompress, faSearch
} from "@fortawesome/free-solid-svg-icons";
import styles from "./styles.module.css";

// LÓGICA DE PARSEO (Optimizada para velocidad)
const parsearDatosEscaneados = (rawData) => {
  if (!rawData || rawData.length < 5) return null;
  
  // Limpieza rápida
  const clean = rawData.replace(/[^A-Za-z0-9Ññ\s]/g, ' ').replace(/\s+/g, ' ').trim();
  
  // Detección de formato digital
  if (clean.includes("PubDSK")) {
    try {
      const match = clean.match(/(\d{8,15})([A-ZÑ]+)(?:0|1)?([MF])(\d{8})/);
      if (match) {
        let cedula = match[1];
        if (cedula.length > 10) cedula = cedula.slice(-10);
        
        return { 
          tipo: "CEDULA_DIGITAL", 
          cedula, 
          apellidos: match[2].substring(0, 20).trim(),
          nombres: match[2].substring(20).trim() || "N/A"
        };
      }
    } catch (e) {
      console.warn("Error parsing digital format:", e);
    }
  }
  
  // Formato tradicional
  const match = clean.match(/(\d{7,10})\s+([A-ZÑ\s]+)\s+([MF])\s+(\d{8})/i);
  if (match) {
    return {
      tipo: "CEDULA_ANTIGUA",
      cedula: match[1].slice(-10),
      apellidos: match[2].split(' ').slice(0, 2).join(' '),
      nombres: match[2].split(' ').slice(2).join(' ') || "N/A"
    };
  }
  
  // Solo números
  const numbers = clean.replace(/\D/g, '');
  if (numbers.length >= 7) {
    return { 
      tipo: "NUMEROS_ENCONTRADOS", 
      cedula: numbers.slice(0, 10),
      rawData: clean
    };
  }
  
  return null;
};

const ScannerModal = ({ isOpen, onClose, onScan }) => {
  // Refs
  const videoRef = useRef(null);
  const codeReaderRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);
  const physicalInputRef = useRef(null);
  const scanTimeoutRef = useRef(null);
  
  // Estados
  const [error, setError] = useState("");
  const [activeMode, setActiveMode] = useState("camera");
  const [torchOn, setTorchOn] = useState(false);
  const [isLandscape, setIsLandscape] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [hasScanned, setHasScanned] = useState(false);
  const [scanMessage, setScanMessage] = useState("");
  const [zoomLevel, setZoomLevel] = useState(1);
  const [isAndroid, setIsAndroid] = useState(false);
  
  // Detectar si es Android
  useEffect(() => {
    const userAgent = navigator.userAgent.toLowerCase();
    setIsAndroid(/android/.test(userAgent) && !/windows/.test(userAgent));
  }, []);
  
  // Detectar orientación con debounce
  useEffect(() => {
    let timeoutId;
    const checkOrientation = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        const isLandscapeNow = window.innerWidth > window.innerHeight;
        setIsLandscape(isLandscapeNow);
      }, 200);
    };
    
    checkOrientation();
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', checkOrientation);
    
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', checkOrientation);
      window.removeEventListener('orientationchange', checkOrientation);
    };
  }, []);
  
  // Inicializar ZXing con configuración optimizada
  useEffect(() => {
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.PDF_417,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39
    ]);
    hints.set(DecodeHintType.TRY_HARDER, true);
    hints.set(DecodeHintType.CHARACTER_SET, 'ISO-8859-1');
    
    codeReaderRef.current = new BrowserMultiFormatReader(hints, 500);
    
    return () => {
      if (codeReaderRef.current) {
        codeReaderRef.current.reset();
      }
    };
  }, []);
  
  // FUNCIÓN MEJORADA DE CÁMARA PARA ANDROID
  const startCamera = useCallback(async () => {
    if (!isOpen || activeMode !== "camera") return;
    
    try {
      setError("");
      setIsLoading(true);
      
      // Detener stream anterior si existe
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      
      // Configuración optimizada para Android
      const constraints = {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: isAndroid ? 1280 : 1920 },
          height: { ideal: isAndroid ? 720 : 1080 },
          frameRate: { ideal: isAndroid ? 24 : 30 },
          // IMPORTANTE: Enfoque automático para Android
          advanced: [
            { focusMode: "continuous" },
            { whiteBalanceMode: "continuous" },
            { exposureMode: "continuous" }
          ]
        }
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        
        // Configuración específica para Android Samsung
        if (isAndroid) {
          videoRef.current.setAttribute('playsinline', 'true');
          videoRef.current.setAttribute('webkit-playsinline', 'true');
          videoRef.current.muted = true;
        }
        
        await videoRef.current.play();
        setIsLoading(false);
        
        // Forzar enfoque cada 3 segundos (para Android)
        if (isAndroid) {
          const focusInterval = setInterval(() => {
            if (streamRef.current) {
              const track = streamRef.current.getVideoTracks()[0];
              if (track && track.getCapabilities && track.getCapabilities().focusDistance) {
                try {
                  track.applyConstraints({
                    advanced: [{ focusMode: "auto" }]
                  });
                } catch (e) {
                  console.log("Auto-focus attempt:", e.message);
                }
              }
            }
          }, 3000);
          
          // Limpiar intervalo al desmontar
          return () => clearInterval(focusInterval);
        }
      }
    } catch (err) {
      console.error("Camera error:", err);
      setIsLoading(false);
      setError(`Error cámara: ${err.message}. Asegúrate de dar permisos.`);
    }
  }, [isOpen, activeMode, isAndroid]);
  
  // Detener cámara correctamente
  const stopCamera = useCallback(() => {
    if (codeReaderRef.current) {
      codeReaderRef.current.reset();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        track.stop();
        track.enabled = false;
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.load();
    }
  }, []);
  
  // FLASH ESPECIAL PARA ANDROID SAMSUNG
  const toggleTorch = useCallback(async () => {
    if (!streamRef.current) return;
    
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;
    
    try {
      // Método 1: Usando ImageCapture API (mejor para Android)
      const imageCapture = new ImageCapture(track);
      const photoCapabilities = await imageCapture.getPhotoCapabilities();
      
      if (photoCapabilities.fillLightMode && 
          photoCapabilities.fillLightMode.includes('flash')) {
        
        const newTorchState = !torchOn;
        await imageCapture.takePhoto({
          fillLightMode: newTorchState ? 'flash' : 'off',
          imageHeight: 1080,
          imageWidth: 1920
        });
        
        setTorchOn(newTorchState);
        return;
      }
      
      // Método 2: Constraints estándar
      if (track.getCapabilities && 'torch' in track.getCapabilities()) {
        await track.applyConstraints({
          advanced: [{ torch: !torchOn }]
        });
        setTorchOn(!torchOn);
        return;
      }
      
      // Método 3: Para dispositivos más antiguos
      const capabilities = track.getCapabilities();
      if (capabilities && capabilities.torch) {
        await track.applyConstraints({
          advanced: [{ torch: !torchOn }]
        });
        setTorchOn(!torchOn);
        return;
      }
      
      alert("Tu dispositivo Android no permite controlar el flash desde el navegador. Usa el flash nativo del celular.");
      
    } catch (err) {
      console.warn("Flash no disponible:", err);
      alert("Para mejor detección, activa el flash manualmente desde tu celular.");
    }
  }, [torchOn]);
  
  // ENFOQUE MANUAL (para Android)
  const triggerFocus = useCallback(() => {
    if (!streamRef.current) return;
    
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;
    
    try {
      // Simular auto-focus
      track.applyConstraints({
        advanced: [
          { focusMode: "manual" },
          { focusDistance: 0.1 }
        ]
      });
      
      setTimeout(() => {
        track.applyConstraints({
          advanced: [{ focusMode: "continuous" }]
        });
      }, 500);
      
      // Feedback visual
      setScanMessage("Enfocando...");
      setTimeout(() => setScanMessage(""), 1000);
      
    } catch (err) {
      console.log("Focus trigger failed:", err);
    }
  }, []);
  
  // ESCANEO CON ZXING MEJORADO
  const startScanning = useCallback(() => {
    if (!codeReaderRef.current || !videoRef.current || !streamRef.current) return;
    
    let isScanning = true;
    
    const scanLoop = async () => {
      if (!isScanning || hasScanned) return;
      
      try {
        const result = await codeReaderRef.current.decodeFromVideoElement(videoRef.current);
        
        if (result && !hasScanned) {
          setHasScanned(true);
          
          // Feedback visual y sonoro
          setScanMessage("¡Cédula detectada!");
          
          // Vibrar si es posible
          if (navigator.vibrate) {
            navigator.vibrate([100, 50, 100]);
          }
          
          // Parsear datos
          const parsed = parsearDatosEscaneados(result.text);
          
          if (parsed) {
            // Mostrar preview por 1 segundo
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Enviar datos y cerrar
            onScan(parsed);
            onClose();
          } else {
            setScanMessage("Formato no reconocido");
            setTimeout(() => {
              setHasScanned(false);
              setScanMessage("");
            }, 2000);
          }
        }
      } catch (err) {
        // Error silencioso - continuar escaneo
      }
      
      // Continuar loop
      if (isScanning && !hasScanned) {
        scanTimeoutRef.current = setTimeout(scanLoop, 500);
      }
    };
    
    scanLoop();
    
    return () => {
      isScanning = false;
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
      }
    };
  }, [hasScanned, onScan, onClose]);
  
  // Efecto principal de cámara
  useEffect(() => {
    if (isOpen && activeMode === "camera") {
      startCamera().then(() => {
        if (videoRef.current && streamRef.current) {
          startScanning();
        }
      });
    } else {
      stopCamera();
      setHasScanned(false);
      setScanMessage("");
    }
    
    return () => {
      stopCamera();
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
      }
    };
  }, [isOpen, activeMode, startCamera, stopCamera, startScanning]);
  
  // Modo físico (lector externo)
  useEffect(() => {
    if (activeMode === "physical" && physicalInputRef.current) {
      physicalInputRef.current.focus();
      
      let buffer = "";
      const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
          if (buffer.length > 5) {
            const parsed = parsearDatosEscaneados(buffer);
            if (parsed) {
              onScan(parsed);
              onClose();
            }
          }
          buffer = "";
        } else if (e.key.length === 1) {
          buffer += e.key;
        }
      };
      
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [activeMode, onScan, onClose]);
  
  // Modo upload simplificado
  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setError("");
    setIsLoading(true);
    
    try {
      // Usar ZXing para imágenes también
      const reader = new FileReader();
      reader.onload = async (e) => {
        const img = new Image();
        img.src = e.target.result;
        
        img.onload = async () => {
          try {
            const result = await codeReaderRef.current.decodeFromImage(img);
            if (result) {
              const parsed = parsearDatosEscaneados(result.text);
              if (parsed) {
                onScan(parsed);
                onClose();
              } else {
                setError("No se pudo extraer información de la imagen");
              }
            } else {
              setError("No se detectó código de barras en la imagen");
            }
          } catch {
            setError("Error procesando imagen");
          } finally {
            setIsLoading(false);
          }
        };
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setError("Error: " + err.message);
      setIsLoading(false);
    }
  };
  
  if (!isOpen) return null;
  
  return (
    <div className={styles.modalOverlay}>
      <div className={`${styles.modalContent} ${isAndroid ? styles.androidOptimized : ''}`}>
        
        {/* Header */}
        <div className={styles.modalHeader}>
          <h3>📸 Escanear Cédula Colombiana</h3>
          <button onClick={onClose} className={styles.closeButton}>
            <FontAwesomeIcon icon={faTimes} size="lg" />
          </button>
        </div>
        
        {/* Loading Overlay */}
        {isLoading && (
          <div className={styles.loadingOverlay}>
            <div className={styles.spinner}></div>
            <p>Iniciando cámara...</p>
            {isAndroid && (
              <p style={{ fontSize: '0.9rem', marginTop: '10px', color: '#ccc' }}>
                Si no funciona, asegúrate de dar permisos de cámara
              </p>
            )}
          </div>
        )}
        
        {/* Scanner Container */}
        <div className={styles.scannerContainer}>
          
          {/* MODO CÁMARA */}
          {activeMode === "camera" && !isLoading && (
            <>
              <div className={`${styles.videoContainer} ${!isLandscape ? styles.forceLandscape : ''}`}>
                <video 
                  ref={videoRef} 
                  autoPlay 
                  playsInline 
                  muted 
                />
                
                {/* Overlay de escaneo */}
                <div className={styles.scannerOverlay}>
                  <div className={styles.scanLine}></div>
                </div>
                
                {/* Mensaje de orientación */}
                {!isLandscape && (
                  <div style={{
                    position: 'absolute',
                    top: '30%',
                    width: '100%',
                    textAlign: 'center',
                    color: '#FFD700',
                    background: 'rgba(0,0,0,0.7)',
                    padding: '15px',
                    zIndex: 200,
                    fontSize: '1.1rem',
                    fontWeight: 'bold'
                  }}>
                    <FontAwesomeIcon icon={faSyncAlt} spin style={{ marginRight: '10px' }} />
                    Gira tu celular horizontalmente
                  </div>
                )}
                
                {/* Mensaje de escaneo */}
                {scanMessage && (
                  <div className={styles.dataIndicator}>
                    <FontAwesomeIcon icon={faCheckCircle} />
                    {scanMessage}
                  </div>
                )}
                
                {/* Instrucciones */}
                <p className={styles.scannerHint}>
                  {isLandscape 
                    ? "📱 Acerca la cédula hasta que el código de barras esté dentro del recuadro"
                    : "↻ Rota tu dispositivo para mejor escaneo"}
                </p>
                
                {/* Botón Flash */}
                <button 
                  onClick={toggleTorch}
                  className={`${styles.torchButton} ${torchOn ? styles.active : ''}`}
                  title={torchOn ? "Apagar flash" : "Encender flash"}
                >
                  <FontAwesomeIcon icon={faBolt} />
                </button>
                
                {/* Botón Enfoque (solo Android) */}
                {isAndroid && (
                  <button 
                    onClick={triggerFocus}
                    className={styles.focusButton}
                    title="Forzar enfoque"
                  >
                    <FontAwesomeIcon icon={faSearch} />
                  </button>
                )}
              </div>
              
              {/* Consejos para Android */}
              {isAndroid && (
                <div style={{
                  position: 'absolute',
                  bottom: '120px',
                  left: '20px',
                  right: '20px',
                  background: 'rgba(255, 165, 0, 0.2)',
                  border: '1px solid rgba(255, 165, 0, 0.3)',
                  borderRadius: '10px',
                  padding: '10px',
                  fontSize: '0.8rem',
                  color: '#FFA500',
                  zIndex: 300,
                  textAlign: 'center'
                }}>
                  💡 <strong>Consejo:</strong> Mantén estable el celular y buena iluminación
                </div>
              )}
            </>
          )}
          
          {/* MODO FÍSICO */}
          {activeMode === "physical" && (
            <div className={styles.alternativeMode}>
              <FontAwesomeIcon icon={faBarcode} size="5x" style={{ color: '#3b82f6', marginBottom: '30px' }} />
              <h3>Modo Lector Físico</h3>
              <p>Conecta tu lector de códigos de barras USB o Bluetooth</p>
              <p style={{ fontSize: '0.9rem', color: '#ccc', marginTop: '20px' }}>
                Escanea directamente en este campo:
              </p>
              <input 
                ref={physicalInputRef}
                style={{
                  width: '80%',
                  padding: '15px',
                  fontSize: '1.2rem',
                  textAlign: 'center',
                  marginTop: '20px',
                  border: '2px solid #3b82f6',
                  borderRadius: '10px',
                  background: 'rgba(255,255,255,0.1)',
                  color: 'white'
                }}
                autoFocus
                placeholder="Escanea aquí..."
              />
            </div>
          )}
          
          {/* MODO UPLOAD */}
          {activeMode === "upload" && (
            <div className={styles.alternativeMode}>
              <FontAwesomeIcon icon={faUpload} size="5x" style={{ color: '#10b981', marginBottom: '30px' }} />
              <h3>Subir Foto</h3>
              <p>Toma una foto clara del código de barras</p>
              
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileUpload}
                ref={fileInputRef}
                style={{ display: 'none' }}
                id="fileInput"
              />
              
              <label htmlFor="fileInput" className={styles.uploadButton}>
                <FontAwesomeIcon icon={faCamera} style={{ marginRight: '10px' }} />
                Tomar Foto o Subir
              </label>
              
              <div style={{ marginTop: '30px', fontSize: '0.9rem', color: '#ccc' }}>
                <p>✅ Mejor con buena luz</p>
                <p>✅ Enfoca bien el código</p>
                <p>✅ Sin reflejos ni sombras</p>
              </div>
            </div>
          )}
        </div>
        
        {/* Tabs */}
        <div className={styles.scannerTabs}>
          <button
            className={activeMode === "camera" ? styles.activeTab : ''}
            onClick={() => setActiveMode("camera")}
          >
            <FontAwesomeIcon icon={faCamera} size="lg" />
            <span>Cámara</span>
          </button>
          <button
            className={activeMode === "physical" ? styles.activeTab : ''}
            onClick={() => setActiveMode("physical")}
          >
            <FontAwesomeIcon icon={faBarcode} size="lg" />
            <span>Físico</span>
          </button>
          <button
            className={activeMode === "upload" ? styles.activeTab : ''}
            onClick={() => setActiveMode("upload")}
          >
            <FontAwesomeIcon icon={faUpload} size="lg" />
            <span>Subir</span>
          </button>
        </div>
        
        {/* Error Display */}
        {error && (
          <div style={{
            position: 'absolute',
            bottom: '80px',
            left: '20px',
            right: '20px',
            background: 'rgba(239, 68, 68, 0.9)',
            color: 'white',
            padding: '15px',
            borderRadius: '10px',
            zIndex: 1000,
            textAlign: 'center',
            animation: 'vibrate 0.3s'
          }}>
            <FontAwesomeIcon icon={faExclamationTriangle} style={{ marginRight: '10px' }} />
            {error}
            <button
              onClick={startCamera}
              style={{
                background: 'white',
                color: '#ef4444',
                border: 'none',
                padding: '8px 20px',
                borderRadius: '5px',
                marginTop: '10px',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              Reintentar
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ScannerModal;