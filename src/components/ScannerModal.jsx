import React, { useState, useEffect, useRef, useCallback } from "react";
import { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } from "@zxing/library";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { 
  faTimes, 
  faBolt, 
  faCamera, 
  faBarcode, 
  faUpload, 
  faFile, 
  faSyncAlt,
  faExclamationTriangle
} from "@fortawesome/free-solid-svg-icons";
import styles from "./styles.module.css";
import { APELLIDOS_COLOMBIANOS } from "../utils/apellidos_colombianos";
import Tesseract from "tesseract.js";

// ============================================================================
// LÓGICA DE PARSEO (Mantenida igual)
// ============================================================================
const parsearDatosEscaneados = (rawData) => {
  if (!rawData || rawData.length < 5) return null;

  let cleanData = "";
  for (let i = 0; i < rawData.length; i++) {
    const charCode = rawData.charCodeAt(i);
    if ((charCode >= 48 && charCode <= 57) || 
        (charCode >= 65 && charCode <= 90) || 
        (charCode >= 97 && charCode <= 122) || 
        charCode === 209 || charCode === 241 || 
        charCode === 32) { 
      cleanData += rawData[i];
    } else {
      cleanData += " ";
    }
  }
  const dataNormalizada = cleanData.replace(/\s+/g, " ").trim();
  
  if (dataNormalizada.includes("PubDSK") || rawData.includes("PubDSK")) {
     try {
        const indexAnchor = cleanData.indexOf("PubDSK");
        let tramaUtil = cleanData.substring(indexAnchor + 6);
        const matchInicio = tramaUtil.match(/.*?(\d{15,25})/);
        if (matchInicio) {
            tramaUtil = tramaUtil.substring(tramaUtil.indexOf(matchInicio[1]));
            const regexDigital = /^(\d+)([A-ZÑ]+)(?:0|\s|1)?([MF])(\d{8})/;
            const match = tramaUtil.match(regexDigital);
            if (match) {
                const cedula = parseInt(match[1].slice(-10), 10).toString();
                const nombresPegados = match[2];
                let apellidos = "";
                let nombres = "";
                let resto = nombresPegados;
                let foundAp1 = false;
                if (typeof APELLIDOS_COLOMBIANOS !== 'undefined') {
                  for (const ap of APELLIDOS_COLOMBIANOS) {
                      if (resto.startsWith(ap)) { apellidos += ap; resto = resto.substring(ap.length); foundAp1 = true; break; }
                  }
                  if (foundAp1) {
                      for (const ap of APELLIDOS_COLOMBIANOS) {
                          if (resto.startsWith(ap)) { apellidos += " " + ap; resto = resto.substring(ap.length); break; }
                      }
                      nombres = resto;
                  } else { apellidos = nombresPegados; nombres = ""; }
                } else { apellidos = nombresPegados; }
                return { tipo: "CEDULA_DIGITAL", cedula, apellidos: apellidos.trim(), nombres: nombres.trim() };
            }
        }
     } catch (e) {}
  }

  const regexSandwich = /(\d{7,15})\s*([A-ZÑ\s]+?)\s*0([MF])(\d{8})/;
  const match = dataNormalizada.match(regexSandwich);

  if (match) {
    try {
      let cedulaRaw = match[1];
      if (cedulaRaw.length > 10) cedulaRaw = cedulaRaw.slice(-10);
      const cedula = parseInt(cedulaRaw, 10).toString();
      const textoNombres = match[2].trim(); 
      const partesNombre = textoNombres.split(" ").filter(Boolean);
      let apellidos = "";
      let nombres = "";
      if (partesNombre.length >= 3) {
        apellidos = `${partesNombre[0]} ${partesNombre[1]}`;
        nombres = partesNombre.slice(2).join(" ");
      } else if (partesNombre.length === 2) {
        apellidos = partesNombre[0];
        nombres = partesNombre[1];
      } else { apellidos = textoNombres; }
      return { tipo: "CEDULA_ANTIGUA", cedula, apellidos: apellidos.trim(), nombres: nombres.trim() };
    } catch (e) {}
  }
  
  const soloNumeros = cleanData.replace(/\D/g, "");
  if (soloNumeros.length >= 7) {
     return { tipo: "CEDULA_SIMPLE", cedula: soloNumeros.slice(0, 15) };
  }
  return null;
};

// ============================================================================
// COMPONENTE: ScannerModal
// ============================================================================
const ScannerModal = ({ isOpen, onClose, onScan }) => {
  const videoRef = useRef(null);
  const codeReaderRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);
  const physicalInputRef = useRef(null);
  const bufferRef = useRef("");
  const timeoutRef = useRef(null);

  const [error, setError] = useState("");
  const [activeMode, setActiveMode] = useState("camera");
  const [torchOn, setTorchOn] = useState(false);
  const [isLandscape, setIsLandscape] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [facingMode, setFacingMode] = useState('environment');

  // Detectar orientación
  useEffect(() => {
    const checkOrientation = () => {
      const isLandscapeNow = window.innerWidth > window.innerHeight;
      setIsLandscape(isLandscapeNow);
    };
    
    checkOrientation();
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', checkOrientation);
    
    return () => {
      window.removeEventListener('resize', checkOrientation);
      window.removeEventListener('orientationchange', checkOrientation);
    };
  }, []);

  // Inicializar ZXing reader
  useEffect(() => {
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.PDF_417, 
      BarcodeFormat.QR_CODE, 
      BarcodeFormat.CODE_128
    ]);
    hints.set(DecodeHintType.TRY_HARDER, true);
    
    codeReaderRef.current = new BrowserMultiFormatReader(hints);
    
    return () => {
      if (codeReaderRef.current) {
        codeReaderRef.current.reset();
      }
    };
  }, []);

  // Función de escaneo exitoso
  const handleScanSuccess = useCallback((parsedData) => {
    stopCamera();
    onScan(parsedData);
    onClose();
  }, [onScan, onClose]);

  // Iniciar cámara
  const startCamera = useCallback(async () => {
    if (streamRef.current && videoRef.current && !videoRef.current.paused) {
      return;
    }

    try {
      setError("");
      setIsLoading(true);
      
      // Detener stream existente
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }

      const constraints = {
        video: { 
          facingMode: facingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          focusMode: "continuous",
          advanced: [{ torch: torchOn }]
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute("playsinline", "true");
        
        await videoRef.current.play();
        setIsLoading(false);

        // Iniciar decodificación
        codeReaderRef.current.decodeFromStream(stream, videoRef.current, (result, err) => {
          if (result) {
            const raw = result.getText();
            const clean = raw.replace(/<[^>]+>/g, '');
            if (clean.length > 5) {
              const parsed = parsearDatosEscaneados(clean);
              if (parsed) {
                handleScanSuccess(parsed);
              }
            }
          }
        });
      }
    } catch (err) {
      console.error("Error cámara:", err);
      setIsLoading(false);
      setError(`Error: ${err.message}. Verifica HTTPS y permisos de cámara.`);
    }
  }, [facingMode, torchOn, handleScanSuccess]);

  // Detener cámara
  const stopCamera = useCallback(() => {
    if (codeReaderRef.current) {
      codeReaderRef.current.reset();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  // Control de flash
  const toggleTorch = async () => {
    if (streamRef.current) {
      const track = streamRef.current.getVideoTracks()[0];
      
      try {
        if (track.getCapabilities && 'torch' in track.getCapabilities()) {
          await track.applyConstraints({
            advanced: [{ torch: !torchOn }]
          });
          setTorchOn(!torchOn);
        } else {
          // Intentar método alternativo
          const imageCapture = new ImageCapture(track);
          const photoCapabilities = await imageCapture.getPhotoCapabilities();
          if (photoCapabilities.fillLightMode && photoCapabilities.fillLightMode.includes('flash')) {
            alert("Flash disponible pero requiere configuración adicional");
          } else {
            alert("Tu dispositivo no soporta control de flash web");
          }
        }
      } catch (e) {
        console.error("Error flash:", e);
        alert("No se pudo controlar el flash");
      }
    }
  };

  // Cambiar cámara (frontal/trasera)
  const switchCamera = async () => {
    stopCamera();
    setFacingMode(prev => prev === 'environment' ? 'user' : 'environment');
    setTimeout(() => startCamera(), 300);
  };

  // Efecto para manejar modos
  useEffect(() => {
    if (isOpen && activeMode === "camera") {
      startCamera();
    } else {
      stopCamera();
    }

    return () => {
      stopCamera();
    };
  }, [isOpen, activeMode, startCamera, stopCamera]);

  // Modo físico - escaneo por teclado
  useEffect(() => {
    if (activeMode === "physical" && physicalInputRef.current) {
      physicalInputRef.current.focus();
      
      const handleKeyDown = (e) => {
        clearTimeout(timeoutRef.current);
        
        if (e.key === 'Enter' || e.key === 'Tab') {
          if (bufferRef.current.length > 5) {
            const parsed = parsearDatosEscaneados(bufferRef.current);
            if (parsed) {
              handleScanSuccess(parsed);
            }
          }
          bufferRef.current = "";
        } else if (e.key.length === 1) {
          bufferRef.current += e.key;
        }
        
        timeoutRef.current = setTimeout(() => {
          bufferRef.current = "";
        }, 200);
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [activeMode, handleScanSuccess]);

  // Modo upload
  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setIsUploading(true);
    setError("");
    
    try {
      const url = URL.createObjectURL(file);
      const { data: { text } } = await Tesseract.recognize(url, 'spa', {
        logger: m => console.log(m)
      });
      
      // Buscar números de cédula
      const numbers = text.match(/\d{6,12}/g);
      if (numbers && numbers.length > 0) {
        // Tomar el número más largo como posible cédula
        const longestNumber = numbers.reduce((a, b) => a.length > b.length ? a : b);
        onScan({ tipo: "CODIGO_SIMPLE", codigo: longestNumber });
        onClose();
      } else {
        setError("No se detectaron números en la imagen. Intenta con una foto más clara.");
      }
    } catch (e) {
      console.error("Error procesando imagen:", e);
      setError("Error procesando la imagen. Intenta con otra foto.");
    }
    
    setIsUploading(false);
  };

  if (!isOpen) return null;

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalContent}>
        
        {/* Header */}
        <div className={styles.modalHeader}>
          <h3>Escanear Cédula</h3>
          <button onClick={onClose} className={styles.closeButton}>
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>

        <div className={styles.scannerContainer}>
          
          {/* MODO CÁMARA */}
          {activeMode === "camera" && (
            <div className={`${styles.videoContainer} ${!isLandscape ? styles.portrait : ''}`}>
              <video ref={videoRef} />
              
              {/* Overlay de orientación */}
              {!isLandscape && (
                <div className={styles.orientationMessage}>
                  <FontAwesomeIcon icon={faSyncAlt} className={styles.spin} /> 
                  <div style={{marginTop: '10px'}}>Gira el celular horizontalmente</div>
                </div>
              )}

              {/* Overlay de escaneo */}
              <div className={styles.scannerOverlay}>
                <div className={styles.scanLine}></div>
              </div>

              {/* Instrucciones */}
              <p className={styles.scannerHint}>
                {isLandscape 
                  ? "Encuadra el código de barras en el recuadro" 
                  : "Coloca el dispositivo en posición horizontal"}
              </p>

              {/* Botón flash */}
              <button 
                onClick={toggleTorch}
                className={`${styles.torchButton} ${torchOn ? styles.active : ''}`}
                disabled={isLoading}
              >
                <FontAwesomeIcon icon={faBolt} />
              </button>

              {/* Botón cambiar cámara (solo si hay frontal) */}
              <button 
                onClick={switchCamera}
                style={{
                  position: 'absolute',
                  right: '20px',
                  bottom: '40px',
                  background: 'rgba(255,255,255,0.2)',
                  color: 'white',
                  border: 'none',
                  width: '50px',
                  height: '50px',
                  borderRadius: '50%',
                  zIndex: 30,
                  cursor: 'pointer'
                }}
              >
                <FontAwesomeIcon icon={faSyncAlt} />
              </button>

              {/* Mensaje de error */}
              {error && (
                <div className={styles.errorMessage}>
                  <FontAwesomeIcon icon={faExclamationTriangle} /> {error}
                  <br />
                  <button onClick={startCamera} className={styles.retryButton}>
                    Reintentar
                  </button>
                </div>
              )}

              {/* Indicador de carga */}
              {isLoading && (
                <div style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  color: 'white',
                  fontSize: '1.2rem',
                  zIndex: 40
                }}>
                  Iniciando cámara...
                </div>
              )}
            </div>
          )}

          {/* MODO FÍSICO */}
          {activeMode === "physical" && (
            <div className={styles.alternativeMode}>
              <FontAwesomeIcon icon={faBarcode} size="4x" style={{marginBottom: '20px'}} />
              <p>Modo escáner físico activo</p>
              <p style={{fontSize: '0.9rem', marginTop: '10px', color: '#ccc'}}>
                Escanea el código de barras con tu lector físico
              </p>
              <input 
                ref={physicalInputRef} 
                autoFocus 
                className={styles.hiddenInput}
                placeholder="Los códigos escaneados aparecerán aquí"
              />
            </div>
          )}

          {/* MODO UPLOAD */}
          {activeMode === "upload" && (
            <div className={styles.alternativeMode}>
              <FontAwesomeIcon icon={faUpload} size="4x" style={{marginBottom: '20px'}} />
              <p>Sube una foto del documento</p>
              
              <input 
                type="file" 
                accept="image/*" 
                onChange={handleFileUpload} 
                className={styles.hiddenInput} 
                id="file-upload"
                ref={fileInputRef}
                disabled={isUploading}
              />
              
              <label 
                htmlFor="file-upload" 
                className={styles.uploadButton}
                style={isUploading ? {opacity: 0.7, cursor: 'not-allowed'} : {}}
              >
                {isUploading ? (
                  <>
                    <FontAwesomeIcon icon={faSyncAlt} spin /> Procesando...
                  </>
                ) : (
                  "Seleccionar Foto"
                )}
              </label>
              
              <p style={{fontSize: '0.8rem', marginTop: '20px', color: '#aaa'}}>
                Formatos: JPG, PNG, GIF • Máx. 5MB
              </p>
            </div>
          )}

        </div>

        {/* Tabs inferiores */}
        <div className={styles.scannerTabs}>
          <button 
            className={activeMode === "camera" ? styles.activeTab : ""} 
            onClick={() => setActiveMode("camera")}
          >
            <FontAwesomeIcon icon={faCamera} /> Cámara
          </button>
          <button 
            className={activeMode === "physical" ? styles.activeTab : ""} 
            onClick={() => setActiveMode("physical")}
          >
            <FontAwesomeIcon icon={faBarcode} /> Físico
          </button>
          <button 
            className={activeMode === "upload" ? styles.activeTab : ""} 
            onClick={() => setActiveMode("upload")}
          >
            <FontAwesomeIcon icon={faUpload} /> Subir
          </button>
        </div>

      </div>
    </div>
  );
};

export default ScannerModal;