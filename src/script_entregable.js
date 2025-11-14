import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";

// =====================================================
// VARIABLES GLOBALES
// =====================================================
let scene, renderer, camera, camcontrols;
let mapa, mapsx, mapsy;

const minlon = -15.46945,
  maxlon = -15.39203;
const minlat = 28.07653,
  maxlat = 28.18235;
const scale = 15;

// =====================================================
// CONFIGURACIÓN VISUAL
// =====================================================
const GUAGUA_STOP_RADIUS = 0.02;
const GUAGUA_STOP_HEIGHT = 0.1;
const GUAGUA_STOP_ACTIVE_COLOR = 0x00ff00;
const ANIMATION_PULSE_DURATION = 1500;
const DISTANCIA_MINIMA_ENTRE_PARADAS = 0.05;

const GROSOR_LINEAS = 0.01;
const GUAGUA_SPEED_BASE = 0.001;
const GUAGUA_SPEED_VARIANCE = 0.0004;

// Configuración de guaguas como CUBOS
const GUAGUA_WIDTH = 0.015;
const GUAGUA_HEIGHT = 0.02;
const GUAGUA_DEPTH = 0.03;

// =====================================================
// ESTRUCTURAS DE DATOS
// =====================================================
let guaguaStops = [];
let guaguaRoutes = [];
let animatedGuaguas = [];

const ROUTE_COLORS = [
  0xff6b6b, 0x4ecdc4, 0x45b7d1, 0xffa07a, 0x98d8c8, 0xf7dc6f, 0xbb8fce,
  0x85c1e2, 0xf8b500, 0x52b788,
];

// =====================================================
// VARIABLES PARA EFECTOS VISUALES
// =====================================================
let particulas = []; // Para partículas cuando llega una guagua
let statsPanel = null; // Panel de estadísticas

// =====================================================
// INICIALIZACIÓN
// =====================================================
init();
animationLoop();

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a0a);

  camera = new THREE.PerspectiveCamera(
    25,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(0, 12, 8);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById("app").appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.5));

  new THREE.TextureLoader().load("src/mapaLPGC.png", (texture) => {
    const data_width = maxlon - minlon;
    const data_height = maxlat - minlat;
    mapsy = scale;
    mapsx = mapsy * (data_width / data_height);

    crearPlanoBase(0, 0, 0, mapsx, mapsy, texture);
    cargarDatosOSM();
  });

  camcontrols = new OrbitControls(camera, renderer.domElement);
  camcontrols.enableDamping = true;
  camcontrols.dampingFactor = 0.05;

  // Crear panel de estadísticas
  crearPanelEstadisticas();

  window.addEventListener("resize", onWindowResize);
}

// =====================================================
// PANEL DE ESTADÍSTICAS
// =====================================================
function crearPanelEstadisticas() {
  statsPanel = document.createElement("div");
  statsPanel.style.cssText = `
    position: absolute;
    top: 20px;
    left: 20px;
    background: rgba(0, 0, 0, 0.8);
    color: #00ff00;
    padding: 15px;
    border-radius: 8px;
    font-family: 'Courier New', monospace;
    font-size: 14px;
    border: 2px solid #00ff00;
    min-width: 200px;
  `;
  document.body.appendChild(statsPanel);
}

function actualizarEstadisticas() {
  if (!statsPanel) return;

  // Contar paradas activas
  let paradasActivas = guaguaStops.filter((p) => p.isAnimating).length;

  // Calcular velocidad promedio
  let velocidadPromedio = 0;
  if (animatedGuaguas.length > 0) {
    velocidadPromedio =
      animatedGuaguas.reduce((sum, b) => sum + b.speed, 0) /
      animatedGuaguas.length;
  }

  statsPanel.innerHTML = `
    <div style="font-weight: bold; margin-bottom: 10px; color: #FFD700;">SISTEMA DE GUAGUAS</div>
    <div>Paradas: ${guaguaStops.length}</div>
    <div>Activas: ${paradasActivas}</div>
    <div>Guaguas: ${animatedGuaguas.length}</div>
    <div>Rutas: ${guaguaRoutes.length}</div>
    <div style="margin-top: 8px; font-size: 11px; color: #888;">
      Vel. Media: ${(velocidadPromedio * 10000).toFixed(1)} km/h
    </div>
  `;
}

// =====================================================
// CREAR PLANO BASE
// =====================================================
function crearPlanoBase(px, py, pz, sx, sy, texture) {
  const geo = new THREE.PlaneGeometry(sx, sy);
  const mat = new THREE.MeshStandardMaterial({
    map: texture,
  });
  mapa = new THREE.Mesh(geo, mat);
  mapa.rotation.x = -Math.PI / 2;
  mapa.position.set(px, py, pz);
  scene.add(mapa);
}

// =====================================================
// CARGA Y PROCESAMIENTO DE DATOS OSM
// =====================================================
function cargarDatosOSM() {
  const loader = new THREE.FileLoader();
  loader.load(
    "src/mapLPGC_MyL2025.osm",
    function (text) {
      const xml = new DOMParser().parseFromString(text, "application/xml");
      const todosLosNodos = indexarNodos(xml);

      procesarCarreteras(xml, todosLosNodos);
      procesarEdificios(xml, todosLosNodos);
      procesarParadasGuagua(xml);
      procesarRutasGuagua(xml, todosLosNodos);

      console.log(`Cargadas ${guaguaStops.length} paradas de guagua`);
      console.log(`Cargadas ${guaguaRoutes.length} rutas de guagua`);
      console.log(`Creados ${animatedGuaguas.length} guaguas animadas`);
    },
    undefined,
    (error) => {
      console.error("Error cargando OSM:", error);
    }
  );
}

function indexarNodos(xml) {
  const nodos = {};
  const xmlNodes = xml.getElementsByTagName("node");

  for (let n of xmlNodes) {
    nodos[n.getAttribute("id")] = {
      lat: parseFloat(n.getAttribute("lat")),
      lon: parseFloat(n.getAttribute("lon")),
    };
  }

  return nodos;
}

// =====================================================
// PROCESAR CARRETERAS
// =====================================================
function procesarCarreteras(xml, nodos) {
  const ways = xml.getElementsByTagName("way");

  for (let w of ways) {
    if (esCarretera(w)) {
      const puntos = extraerPuntosWay(w, nodos);
      if (puntos.length > 1) {
        dibujarCarretera(puntos);
      }
    }
  }
}

function esCarretera(way) {
  const tags = way.getElementsByTagName("tag");
  for (let t of tags) {
    if (t.getAttribute("k") === "highway") return true;
  }
  return false;
}

function dibujarCarretera(puntos) {
  const geometry = new THREE.BufferGeometry().setFromPoints(
    puntos.map((p) => new THREE.Vector3(p.x, 0.001, p.y))
  );
  const linea = new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({
      color: 0x444444,
      opacity: 0.6,
      transparent: true,
    })
  );
  scene.add(linea);
}

// =====================================================
// PROCESAR EDIFICIOS
// =====================================================
function procesarEdificios(xml, nodos) {
  const ways = xml.getElementsByTagName("way");

  for (let w of ways) {
    if (esEdificio(w)) {
      const puntos = extraerPuntosWay(w, nodos);
      if (puntos.length > 2) {
        dibujarEdificio(puntos);
      }
    }
  }
}

function esEdificio(way) {
  const tags = way.getElementsByTagName("tag");
  for (let t of tags) {
    if (t.getAttribute("k") === "building") return true;
  }
  return false;
}

function dibujarEdificio(puntos) {
  if (THREE.ShapeUtils.isClockWise(puntos)) puntos.reverse();

  const shape = new THREE.Shape(puntos);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.04,
    bevelEnabled: false,
  });

  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color: 0xaaaaaa,
      roughness: 0.9,
      metalness: 0.1,
    })
  );

  mesh.rotation.x = Math.PI / 2;
  mesh.position.y = 0.002;
  scene.add(mesh);
}

// =====================================================
// PROCESAR PARADAS DE GUAGUA
// =====================================================
function procesarParadasGuagua(xml) {
  const xmlNodes = xml.getElementsByTagName("node");
  let colorIndex = 0;

  for (let n of xmlNodes) {
    if (esParadaGuagua(n)) {
      const lat = parseFloat(n.getAttribute("lat"));
      const lon = parseFloat(n.getAttribute("lon"));
      const id = n.getAttribute("id");

      const mx = convertirLon(lon);
      const mz = convertirLat(lat);
      const nuevaPosicion = new THREE.Vector3(
        mx,
        GUAGUA_STOP_HEIGHT / 2 + 0.005,
        mz
      );

      // Comprobar si esta posición está muy cerca de una parada existente
      let estaDemasiadoCerca = false;
      for (const paradaExistente of guaguaStops) {
        if (
          paradaExistente.position.distanceTo(nuevaPosicion) <
          DISTANCIA_MINIMA_ENTRE_PARADAS
        ) {
          estaDemasiadoCerca = true;
          break; // Dejar de buscar, ya hemos encontrado una cerca
        }
      }

      // Si NO está demasiado cerca, la creamos
      if (!estaDemasiadoCerca) {
        const color = ROUTE_COLORS[colorIndex % ROUTE_COLORS.length];
        colorIndex++;
        // Pasamos la nueva psicion que ya calculamos
        crearParadaGuagua(nuevaPosicion.x, nuevaPosicion.z, id, color);
      }
    }
  }
}

function esParadaGuagua(node) {
  const tags = node.getElementsByTagName("tag");
  for (let t of tags) {
    if (
      t.getAttribute("k") === "highway" &&
      t.getAttribute("v") === "bus_stop"
    ) {
      return true;
    }
  }
  return false;
}

function crearParadaGuagua(x, z, id, color) {
  const geometry = new THREE.CylinderGeometry(
    GUAGUA_STOP_RADIUS,
    GUAGUA_STOP_RADIUS,
    GUAGUA_STOP_HEIGHT,
    16
  );

  const material = new THREE.MeshStandardMaterial({
    color: color,
    emissive: color,
    emissiveIntensity: 0.3,
    roughness: 0.5,
    metalness: 0.3,
  });

  const cilindro = new THREE.Mesh(geometry, material);
  cilindro.position.set(x, GUAGUA_STOP_HEIGHT / 2 + 0.005, z);
  scene.add(cilindro);

  guaguaStops.push({
    mesh: cilindro,
    id: id,
    position: new THREE.Vector3(x, GUAGUA_STOP_HEIGHT / 2 + 0.005, z),
    color: color,
    baseColor: color,
    isAnimating: false,
    animationStart: 0,
    originalScale: cilindro.scale.clone(),
  });
}

// =====================================================
// PROCESAR RUTAS DE GUAGUAS
// =====================================================
function procesarRutasGuagua(xml, nodos) {
  const relations = xml.getElementsByTagName("relation");
  let routeIndex = 0;

  for (let r of relations) {
    if (esRutaGuagua(r)) {
      const puntosRuta = extraerPuntosRuta(r, nodos);

      if (puntosRuta.length > 1) {
        const colorRuta = ROUTE_COLORS[routeIndex % ROUTE_COLORS.length];
        routeIndex++;

        crearRutaGuagua(puntosRuta, colorRuta);
      }
    }
  }
}

function esRutaGuagua(relation) {
  const tags = relation.getElementsByTagName("tag");
  for (let t of tags) {
    if (t.getAttribute("k") === "route" && t.getAttribute("v") === "bus") {
      return true;
    }
  }
  return false;
}

function extraerPuntosRuta(relation, nodos) {
  const puntos = [];
  const members = relation.getElementsByTagName("member");

  for (let m of members) {
    if (m.getAttribute("type") === "node") {
      const ref = m.getAttribute("ref");
      if (nodos[ref]) {
        const mx = convertirLon(nodos[ref].lon);
        const mz = convertirLat(nodos[ref].lat);
        puntos.push(new THREE.Vector3(mx, 0.01, mz));
      }
    }
  }

  return puntos;
}

function crearRutaGuagua(puntos, color) {
  const cilindros = [];

  for (let i = 0; i < puntos.length - 1; i++) {
    const cilindro = crearCilindroEntre(
      puntos[i],
      puntos[i + 1],
      color,
      GROSOR_LINEAS
    );
    cilindros.push(cilindro);
    scene.add(cilindro);
  }

  const guaguas = crearGuaguasParaRuta(puntos, color);

  guaguaRoutes.push({
    color: color,
    points: puntos,
    cylinders: cilindros,
    guaguas: guaguas,
  });
}

function crearCilindroEntre(p1, p2, color, grosor) {
  const direccion = new THREE.Vector3().subVectors(p2, p1);
  const longitud = direccion.length();

  const geometry = new THREE.CylinderGeometry(grosor, grosor, longitud, 8);
  const material = new THREE.MeshStandardMaterial({
    color: color,
    emissive: color,
    emissiveIntensity: 0.2,
    roughness: 0.6,
    metalness: 0.4,
  });

  const cilindro = new THREE.Mesh(geometry, material);

  const puntoMedio = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
  cilindro.position.copy(puntoMedio);

  cilindro.lookAt(p2);
  cilindro.rotateX(Math.PI / 2);

  return cilindro;
}

// =====================================================
// CREAR GUAGUAS COMO CUBOS
// =====================================================
function crearGuaguasParaRuta(puntos, color) {
  const guaguas = [];
  const numGuaguas = Math.max(1, Math.floor(puntos.length / 20));

  for (let i = 0; i < numGuaguas; i++) {
    const guagua = crearGuaguaCubo(color);
    const progresoInicial = i / numGuaguas;

    const indiceInicial = Math.floor(progresoInicial * (puntos.length - 1));
    guagua.position.copy(puntos[indiceInicial]);

    scene.add(guagua);

    const guaguaObj = {
      mesh: guagua,
      route: puntos,
      progress: progresoInicial,
      speed: GUAGUA_SPEED_BASE + Math.random() * GUAGUA_SPEED_VARIANCE,
      color: color,
      lastStopIndex: -1,
    };

    guaguas.push(guaguaObj);
    animatedGuaguas.push(guaguaObj);
  }

  return guaguas;
}

// =====================================================
// CREAR GUAGUAS COMO CUBO 3D
// =====================================================
function crearGuaguaCubo(color) {
  // Cuerpo principal de la guagua
  const bodyGeometry = new THREE.BoxGeometry(
    GUAGUA_WIDTH,
    GUAGUA_HEIGHT,
    GUAGUA_DEPTH
  );
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: color,
    emissive: color,
    emissiveIntensity: 0.5,
    roughness: 0.3,
    metalness: 0.7,
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);

  // Ventanas parte superior más oscura
  const windowGeometry = new THREE.BoxGeometry(
    GUAGUA_WIDTH * 0.8,
    GUAGUA_HEIGHT * 0.4,
    GUAGUA_DEPTH * 0.7
  );
  const windowMaterial = new THREE.MeshStandardMaterial({
    color: 0x222222,
    metalness: 0.9,
    roughness: 0.1,
  });
  const windows = new THREE.Mesh(windowGeometry, windowMaterial);
  windows.position.y = GUAGUA_HEIGHT * 0.3;
  body.add(windows);

  return body;
}

// =====================================================
// CREAR PARTÍCULAS CUANDO LLEGA UNA GUAGUA
// =====================================================
function crearParticula(posicion, color) {
  const geometry = new THREE.SphereGeometry(0.009, 100, 100);
  const material = new THREE.MeshBasicMaterial({
    color: color,
    transparent: true,
    opacity: 1,
  });
  const particula = new THREE.Mesh(geometry, material);
  particula.position.copy(posicion);

  scene.add(particula);

  // Guardar info de la partícula
  particulas.push({
    mesh: particula,
    vida: 1.0, // Tiempo de vida (1 = 100%)
    velocidadY: 0.005 + Math.random() * 0.005, // Sube hacia arriba
  });
}

function actualizarParticulas() {
  // Actualizar cada partícula
  for (let i = particulas.length - 1; i >= 0; i--) {
    const p = particulas[i];

    // Mover hacia arriba
    p.mesh.position.y += p.velocidadY;

    // Reducir vida
    p.vida -= 0.02;

    // Actualizar opacidad
    p.mesh.material.opacity = p.vida;

    // Eliminar si se agotó la vida
    if (p.vida <= 0) {
      scene.remove(p.mesh);
      particulas.splice(i, 1);
    }
  }
}

// =====================================================
// EXTRAER PUNTOS DE UN WAY
// =====================================================
function extraerPuntosWay(way, nodos) {
  const puntos = [];
  const nodeRefs = way.getElementsByTagName("nd");

  for (let nd of nodeRefs) {
    const ref = nd.getAttribute("ref");
    if (nodos[ref]) {
      const mx = convertirLon(nodos[ref].lon);
      const mz = convertirLat(nodos[ref].lat);
      puntos.push(new THREE.Vector2(mx, mz));
    }
  }

  return puntos;
}

// =====================================================
// CONVERSIÓN DE COORDENADAS
// =====================================================
function convertirLon(lon) {
  return mapearRango(lon, minlon, maxlon, -mapsx / 2, mapsx / 2);
}

function convertirLat(lat) {
  return mapearRango(lat, minlat, maxlat, mapsy / 2, -mapsy / 2);
}

function mapearRango(v, vmin, vmax, dmin, dmax) {
  return dmin + ((v - vmin) / (vmax - vmin)) * (dmax - dmin);
}

// =====================================================
// ANIMACIÓN PRINCIPAL
// =====================================================
function animationLoop() {
  requestAnimationFrame(animationLoop);

  const tiempoActual = Date.now();

  // Actualizar guaguas
  animatedGuaguas.forEach((guaguaObj) => {
    actualizarGuagua(guaguaObj, tiempoActual);
  });

  // Actualizar paradas
  guaguaStops.forEach((parada) => {
    actualizarAnimacionParada(parada, tiempoActual);
  });

  // Actualizar partículas
  actualizarParticulas();

  // Actualizar estadísticas cada 500ms
  if (tiempoActual % 500 < 16) {
    actualizarEstadisticas();
  }

  camcontrols.update();
  renderer.render(scene, camera);
}

function actualizarGuagua(guaguaObj, tiempoActual) {
  const ruta = guaguaObj.route;
  let progreso = guaguaObj.progress + guaguaObj.speed;

  if (progreso > 1) {
    progreso = 0;
    guaguaObj.lastStopIndex = -1;
  }

  const totalSegmentos = ruta.length - 1;
  const indiceSegmento = Math.floor(progreso * totalSegmentos);
  const progresoSegmento = (progreso * totalSegmentos) % 1;

  const inicio = ruta[indiceSegmento];
  const fin = ruta[Math.min(indiceSegmento + 1, ruta.length - 1)];

  guaguaObj.mesh.position.lerpVectors(inicio, fin, progresoSegmento);

  // ORIENTAR la guagua hacia donde se mueve
  const direccion = new THREE.Vector3().subVectors(fin, inicio);
  if (direccion.length() > 0.001) {
    const angulo = Math.atan2(direccion.x, direccion.z);
    guaguaObj.mesh.rotation.y = angulo;
  }

  guaguaObj.progress = progreso;

  detectarLlegadaParada(guaguaObj, tiempoActual);
}

function detectarLlegadaParada(guaguaObj, tiempoActual) {
  const posicionGuagua = guaguaObj.mesh.position;
  const DISTANCIA_ACTIVACION = 0.05;

  guaguaStops.forEach((parada, index) => {
    const distancia = posicionGuagua.distanceTo(parada.position);

    if (distancia < DISTANCIA_ACTIVACION && guaguaObj.lastStopIndex !== index) {
      activarAnimacionParada(parada, tiempoActual);
      guaguaObj.lastStopIndex = index;

      // crear particulas cuando llega a parada
      for (let i = 0; i < 5; i++) {
        crearParticula(parada.position.clone(), guaguaObj.color);
      }
    }
  });
}

function activarAnimacionParada(parada, tiempoActual) {
  if (!parada.isAnimating) {
    parada.isAnimating = true;
    parada.animationStart = tiempoActual;

    parada.mesh.material.color.setHex(GUAGUA_STOP_ACTIVE_COLOR);
    parada.mesh.material.emissive.setHex(GUAGUA_STOP_ACTIVE_COLOR);
    parada.mesh.material.emissiveIntensity = 0.8;
  }
}

function actualizarAnimacionParada(parada, tiempoActual) {
  if (parada.isAnimating) {
    const tiempoTranscurrido = tiempoActual - parada.animationStart;
    const progreso = tiempoTranscurrido / ANIMATION_PULSE_DURATION;

    if (progreso < 1) {
      // Crece y decrece 4 veces
      const escala = 1 + Math.sin(progreso * Math.PI * 4) * 0.3;
      parada.mesh.scale.copy(parada.originalScale).multiplyScalar(escala);

      const intensidad = 0.8 * (1 - progreso);
      parada.mesh.material.emissiveIntensity = intensidad;
    } else {
      // Restaurar
      parada.mesh.scale.copy(parada.originalScale);
      parada.mesh.material.color.setHex(parada.baseColor);
      parada.mesh.material.emissive.setHex(parada.baseColor);
      parada.mesh.material.emissiveIntensity = 0.3;
      parada.isAnimating = false;
    }
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
