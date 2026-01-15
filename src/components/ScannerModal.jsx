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
  faSyncAlt 
} from "@fortawesome/free-solid-svg-icons";
import Tesseract from "tesseract.js";
import styles from "./styles.module.css";
import { APELLIDOS_COLOMBIANOS } from "../utils/apellidos_colombianos";

// ============================================================================
// LÓGICA DE PARSEO (CÉDULAS COLOMBIANAS)
// ============================================================================
const parsearDatosEscaneados = (rawData) => {
  if (!rawData || rawData.length < 5) return null;

  console.log("=== INICIANDO PARSEO ===");
  
  // 1. LIMPIEZA INICIAL
  let cleanData = "";
  for (let i = 0; i < rawData.length; i++) {
    const charCode = rawData.charCodeAt(i);
    // Dejar pasar solo lo útil: Letras, Números, Ñ, Espacios
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
  console.log("Data Normalizada:", dataNormalizada);
  
  // CASO 1: CÉDULA DIGITAL (PubDSK)
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
                // const genero = match[3];
                // const f = match[4];
                
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
                } else {
                   apellidos = nombresPegados;
                }

                return { tipo: "CEDULA_DIGITAL", cedula, apellidos: apellidos.trim(), nombres: nombres.trim() };
            }
        }
     } catch (e) { console.error("Error Digital:", e); }
  }

  // CASO 2: CÉDULA ANTIGUA (Estrategia Sándwich)
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
      } else {
        apellidos = textoNombres;
      }

      return { tipo: "CEDULA_ANTIGUA", cedula, apellidos: apellidos.trim(), nombres: nombres.trim() };
    } catch (e) { console.error("Error procesando antigua:", e); }
  }
  
  // Fallback solo números (si el usuario escanea un código simple)
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
  const scannerRef = useRef(null);
  const physicalInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const codeReaderRef = useRef(null);

  const [error, setError] = useState("");
  const [isMobile, setIsMobile] = useState(false);
  const [activeMode, setActiveMode] = useState("camera"); // camera, physical, upload
  
  // Upload States
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  
  // Flash/Torch States
  const [videoTrack, setVideoTrack] = useState(null);
  const [torchOn, setTorchOn] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);

  // Buffer para escáner físico
  const bufferRef = useRef("");
  const timeoutRef = useRef(null);
  const [showSecurityWarning, setShowSecurityWarning] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768 || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent));
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // --- LÓGICA DE LIMPIEZA ---
  const limpiarBuffer = useCallback((data) => {
    if (!data) return "";
    return data
      .replace(/<F\d+>/gi, "")
      .replace(/<CR>|<LF>|<GS>|<RS>|<US>/gi, "")
      .split("")
      .filter((ch) => {
        const code = ch.charCodeAt(0);
        return (code >= 32 && code <= 126) || code === 209 || code === 241;
      })
      .join("");
  }, []);

  // --- PROCESAR BUFFER FÍSICO ---
  const procesarBuffer = useCallback(() => {
    const raw = bufferRef.current;
    bufferRef.current = "";
    
    const dataLimpia = limpiarBuffer(raw);
    if (!dataLimpia || dataLimpia.length < 3) return;

    const resultado = parsearDatosEscaneados(raw); // Usamos raw para intentar detectar PubDSK antes de limpiar
    
    if (resultado) {
      onScan(resultado);
    } else {
      onScan({ tipo: "CODIGO_SIMPLE", codigo: dataLimpia });
    }
    onClose();
  }, [limpiarBuffer, onScan, onClose]);

  // --- CÁMARA: INICIALIZACIÓN PRO (1080p + PDF417) ---
  const handleCameraScan = useCallback(
    (text) => {
      if (text.length < 8) return; // Filtro de ruido
      const dataLimpia = limpiarBuffer(text);
      const resultado = parsearDatosEscaneados(dataLimpia);
      if (resultado) {
        onScan(resultado);
        onClose();
      }
    },
    [limpiarBuffer, onScan, onClose]
  );

  const toggleTorch = async () => {
    if (videoTrack && hasTorch) {
      try {
        await videoTrack.applyConstraints({
          advanced: [{ torch: !torchOn }]
        });
        setTorchOn(!torchOn);
      } catch (err) {
        console.error("Error cambiando flash:", err);
      }
    }
  };

  const initScanner = useCallback(async () => {
    if (!scannerRef.current) return;
    
    try {
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.PDF_417, // Prioridad absoluta Cédula
        BarcodeFormat.QR_CODE,
        BarcodeFormat.CODE_128
      ]);
      hints.set(DecodeHintType.TRY_HARDER, true);

      const codeReader = new BrowserMultiFormatReader(hints);
      codeReaderRef.current = codeReader;

      const videoElement = document.createElement("video");
      videoElement.style.width = "100%";
      videoElement.style.height = "100%";
      videoElement.style.objectFit = "cover";

      scannerRef.current.innerHTML = "";
      scannerRef.current.appendChild(videoElement);

      // ALTA RESOLUCIÓN
      const constraints = {
        video: { 
          facingMode: "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          focusMode: "continuous"
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // DETECTAR LINTERNA
      const track = stream.getVideoTracks()[0];
      setVideoTrack(track);
      
      const capabilities = track.getCapabilities ? track.getCapabilities() : {};
      if (capabilities.torch) setHasTorch(true);

      videoElement.srcObject = stream;
      videoElement.setAttribute("playsinline", "true");
      await videoElement.play();

      codeReader.decodeFromStream(stream, videoElement, (result) => {
        if (result) handleCameraScan(result.getText());
      });

    } catch (err) {
      console.error("Error inicializando scanner:", err);
      setError("No se pudo acceder a la cámara. Verifique permisos y HTTPS.");
    }
  }, [handleCameraScan]);

  const stopScanner = useCallback(() => {
    if (codeReaderRef.current) {
      codeReaderRef.current.reset();
      codeReaderRef.current = null;
    }
    if (videoTrack) {
      videoTrack.stop();
      setVideoTrack(null);
    }
    setTorchOn(false);
  }, [videoTrack]);

  // --- SUBIDA DE ARCHIVOS ---
  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadedFileName(file.name);
    setIsUploading(true);
    setError("");
    
    try {
      const imageUrl = URL.createObjectURL(file);
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.PDF_417, BarcodeFormat.CODE_128, BarcodeFormat.QR_CODE
      ]);
      hints.set(DecodeHintType.TRY_HARDER, true);

      const codeReader = new BrowserMultiFormatReader(hints);
      
      // Intentar lectura directa ZXing
      try {
        const result = await codeReader.decodeFromImageUrl(imageUrl);
        if (result) {
            const dataLimpia = limpiarBuffer(result.getText());
            const resultado = parsearDatosEscaneados(dataLimpia);
            onScan(resultado || { tipo: "CODIGO_SIMPLE", codigo: dataLimpia });
            onClose();
            return;
        }
      } catch (e) { console.log("Fallo lectura directa, intentando OCR..."); }

      // Fallback OCR
      const { data: { text } } = await Tesseract.recognize(imageUrl, 'spa', {
         logger: m => console.log(m) 
      });
      
      const regexCodigos = /\b\d{8,20}\b/g;
      const matches = text.match(regexCodigos);
          
      if (matches && matches.length > 0) {
        onScan({ tipo: "CODIGO_SIMPLE", codigo: matches[0] });
        onClose();
      } else {
        setError('No se encontraron códigos claros en la imagen.');
      }

      URL.revokeObjectURL(imageUrl);
    } catch (error) {
      setError(`Error procesando imagen: ${error.message}`);
    } finally {
      setIsUploading(false);
      setUploadedFileName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // --- ESCÁNER FÍSICO (EVENTOS) ---
  useEffect(() => {
    if (!isOpen || activeMode !== "physical") return;

    const handleKeyDown = (e) => {
      const key = e.key;
      // Bloquear teclas de navegación si es necesario
      if (key === "Enter") {
        e.preventDefault();
        if (bufferRef.current.length > 5) procesarBuffer();
        return;
      }
      if (key.length === 1) {
        bufferRef.current += key;
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
          if (bufferRef.current.length >= 7) procesarBuffer();
        }, 300); 
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    // Auto-focus trampa
    const interval = setInterval(() => {
         if(physicalInputRef.current) physicalInputRef.current.focus({preventScroll:true});
    }, 500);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      clearInterval(interval);
    };
  }, [isOpen, activeMode, procesarBuffer]);

  // --- EFECTOS GENERALES ---
  useEffect(() => {
    if (isOpen && activeMode === "camera") {
      setError("");
      const timer = setTimeout(initScanner, 300);
      return () => {
        clearTimeout(timer);
        stopScanner();
      };
    } else {
      stopScanner();
    }
  }, [isOpen, activeMode, initScanner, stopScanner]);

  if (!isOpen) return null;

  return (
    <div className={styles.modalOverlay}>
      <div className={`${styles.modalContent} ${isMobile ? styles.mobileModal : ''}`}>
        
        {/* HEADER */}
        <div className={styles.modalHeader}>
          <h3>Escanear Código</h3>
          <button type="button" onClick={onClose} className={styles.closeButton}>
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>

        {/* CONTENIDO DINÁMICO */}
        <div className={styles.scannerContainer} style={{flex: 1, position: 'relative', display: 'flex', flexDirection: 'column'}}>
          
          {/* MODO CÁMARA */}
          {activeMode === "camera" && (
            <>
              {error ? (
                <div className={styles.scannerError} style={{color: 'white', textAlign: 'center', marginTop: 'auto', marginBottom: 'auto'}}>
                    <p>{error}</p>
                    <button onClick={() => { setError(""); initScanner(); }} className={styles.retryButton}>
                        Reintentar
                    </button>
                </div>
              ) : (
                <>
                    <div ref={scannerRef} className={styles.qrReader} />
                    <div className={styles.scannerOverlay}>
                        <div className={styles.scanLine}></div>
                    </div>
                    <p className={styles.scannerHint}>
                        Gira el celular y encaja el código de barras en el recuadro
                    </p>
                    {hasTorch && (
                        <button 
                        className={`${styles.torchButton} ${torchOn ? styles.torchButtonActive : ''}`}
                        onClick={toggleTorch}
                        >
                        <FontAwesomeIcon icon={faBolt} />
                        </button>
                    )}
                </>
              )}
            </>
          )}

          {/* MODO FÍSICO */}
          {activeMode === "physical" && (
            <div className={styles.physicalScannerContainer} style={{flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'white'}}>
                <FontAwesomeIcon icon={faBarcode} size="4x" style={{marginBottom: '20px', opacity: 0.8}} />
                <h3>Modo Escáner USB</h3>
                <p style={{textAlign: 'center', maxWidth: '80%', opacity: 0.7}}>
                   Conecte su lector y escanee el código. No necesita hacer clic en ningún lado.
                </p>
                <input
                    ref={physicalInputRef}
                    type="text"
                    className={styles.hiddenInputTrap}
                    style={{opacity: 0, position: 'absolute'}}
                    autoFocus
                />
            </div>
          )}

          {/* MODO SUBIR ARCHIVO */}
          {activeMode === "upload" && (
             <div className={styles.uploadContainer} style={{flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'white'}}>
                <div className={styles.uploadArea} style={{textAlign: 'center'}}>
                    <FontAwesomeIcon icon={faFile} size="3x" style={{marginBottom: '15px'}} />
                    <h3>Subir Imagen</h3>
                    <input
                      ref={fileInputRef}
                      type="file"
                      id="barcode-file"
                      accept=".jpg,.jpeg,.png,.webp"
                      onChange={handleFileUpload}
                      disabled={isUploading}
                      style={{display: 'none'}}
                    />
                    <label 
                      htmlFor="barcode-file" 
                      className={styles.uploadButton}
                      style={{
                          display: 'inline-block', 
                          padding: '10px 20px', 
                          background: '#2563eb', 
                          borderRadius: '8px', 
                          cursor: 'pointer',
                          marginTop: '10px'
                      }}
                    >
                      {isUploading ? (
                        <>
                          <FontAwesomeIcon icon={faSyncAlt} spin /> Procesando...
                        </>
                      ) : (
                        <>
                          <FontAwesomeIcon icon={faUpload} /> Seleccionar Imagen
                        </>
                      )}
                    </label>
                    <p style={{fontSize: '0.8rem', marginTop: '15px', opacity: 0.7}}>
                        Soporta imágenes de alta calidad (JPG, PNG)
                    </p>
                    {error && <p style={{color: '#ef4444', marginTop: '10px'}}>{error}</p>}
                </div>
             </div>
          )}
        </div>

        {/* TABS INFERIORES */}
        <div className={styles.scannerTabs}>
          <button
            className={`${styles.scannerTab} ${activeMode === "camera" ? styles.activeTab : ""}`}
            onClick={() => setActiveMode("camera")}
          >
            <FontAwesomeIcon icon={faCamera} /> Cámara
          </button>
          <button
            className={`${styles.scannerTab} ${activeMode === "physical" ? styles.activeTab : ""}`}
            onClick={() => setActiveMode("physical")}
          >
            <FontAwesomeIcon icon={faBarcode} /> Físico
          </button>
          <button
            className={`${styles.scannerTab} ${activeMode === "upload" ? styles.activeTab : ""}`}
            onClick={() => setActiveMode("upload")}
          >
            <FontAwesomeIcon icon={faUpload} /> Archivo
          </button>
        </div>
      </div>
    </div>
  );
};

export default ScannerModal;