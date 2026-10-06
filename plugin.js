// Radio en vivo (v0.6.0): categorías de radio por zona, país y tema.
// Fuentes: directorio público Radio Browser (radio-browser.info) y, para las radios de
// Santa Cruz de la Sierra (Bolivia), Radio Garden (radio.garden, interfaz no oficial).
//
// Para agregar un país nuevo basta con sumar una línea con pais("PA", "Panamá"):
// el código es el de dos letras del país (ISO 3166).
// Cada categoría muestra sus 50 radios más escuchadas.

const DIEZ_MINUTOS = 10 * 60 * 1000;
const TREINTA_DIAS = 30 * 24 * 60 * 60 * 1000;
const RADIO_GARDEN = "https://radio.garden";

// Servidores del directorio; si uno falla, prueba el siguiente.
const SERVIDORES = ["de1.api.radio-browser.info", "nl1.api.radio-browser.info"];

// Radios de Bolivia que el directorio no tiene: se agregan a mano con su dirección de transmisión.
// Formato: { titulo: "Radio Marítima 100.9 FM", url: "https://...", logo: "https://..." } (el logo es opcional).
const EXTRAS_BOLIVIA = [];

function pais(codigo, titulo) {
  return { id: codigo.toLowerCase(), titulo, country: codigo, consulta: { countrycode: codigo, limit: 50 } };
}

// Países de la categoría Radio Disney: se busca la emisora de cada uno en el directorio.
const PAISES_DISNEY = [
  { codigo: "AR", titulo: "Argentina" },
  { codigo: "BO", titulo: "Bolivia" },
  { codigo: "BR", titulo: "Brasil" },
  { codigo: "CL", titulo: "Chile" },
  { codigo: "CR", titulo: "Costa Rica" },
  { codigo: "EC", titulo: "Ecuador" },
  { codigo: "MX", titulo: "México" },
  { codigo: "PA", titulo: "Panamá" },
  { codigo: "PY", titulo: "Paraguay" },
  { codigo: "PE", titulo: "Perú" },
  { codigo: "DO", titulo: "República Dominicana" },
  { codigo: "UY", titulo: "Uruguay" },
];

// Categorías en el orden en que aparecen en Kino.
const CATEGORIAS = [
  { id: "disney", titulo: "Radio Disney", disney: PAISES_DISNEY },
  {
    id: "bo",
    titulo: "Bolivia",
    country: "BO",
    consulta: { countrycode: "BO", limit: 50 },
    extras: EXTRAS_BOLIVIA,
    radioGarden: "Santa Cruz de la Sierra",
  },
  pais("AR", "Argentina"),
  pais("BR", "Brasil"),
  pais("CL", "Chile"),
  pais("CO", "Colombia"),
  pais("EC", "Ecuador"),
  pais("ES", "España"),
  pais("US", "Estados Unidos"),
  pais("MX", "México"),
  pais("PY", "Paraguay"),
  pais("PE", "Perú"),
  pais("UY", "Uruguay"),
  pais("VE", "Venezuela"),
  { id: "anime", titulo: "Anime", consulta: { tag: "anime", limit: 50 } },
];

const memoria = {};

// Minúsculas y sin tildes, para comparar y ordenar nombres.
function plano(texto) {
  return String(texto || "")
    .toLowerCase()
    .replace(/[áàäâã]/g, "a")
    .replace(/[éèëê]/g, "e")
    .replace(/[íìïî]/g, "i")
    .replace(/[óòöôõ]/g, "o")
    .replace(/[úùüû]/g, "u")
    .replace(/ñ/g, "n")
    .replace(/ç/g, "c")
    .replace(/\s+/g, " ")
    .trim();
}

// Orden alfabético "natural": pone Radio 2 antes que Radio 10.
function compararNombres(a, b) {
  const ta = plano(a.title).match(/\d+|\D+/g) || [];
  const tb = plano(b.title).match(/\d+|\D+/g) || [];
  const n = Math.min(ta.length, tb.length);
  for (let i = 0; i < n; i++) {
    const x = ta[i];
    const y = tb[i];
    if (x === y) continue;
    if (/^\d/.test(x) && /^\d/.test(y)) {
      const dif = Number(x) - Number(y);
      if (dif !== 0) return dif;
    } else {
      return x < y ? -1 : 1;
    }
  }
  return ta.length - tb.length;
}

async function pedirEmisoras(consulta) {
  const partes = [];
  for (const k of Object.keys(consulta)) {
    partes.push(encodeURIComponent(k) + "=" + encodeURIComponent(consulta[k]));
  }
  const ruta = "/json/stations/search?" + partes.join("&") + "&order=clickcount&reverse=true&hidebroken=true";
  let ultimoError = "sin respuesta";
  for (const servidor of SERVIDORES) {
    try {
      const r = await kino.fetch("https://" + servidor + ruta, {
        headers: { Accept: "application/json", "User-Agent": "Kino-Radio/0.2" },
        timeoutMs: 9000,
      });
      if (r.ok) {
        const datos = r.json();
        if (Array.isArray(datos)) return datos;
        ultimoError = "respuesta inesperada";
      } else {
        ultimoError = servidor + " respondió " + r.status;
      }
    } catch (e) {
      ultimoError = servidor + ": " + (e && e.code ? e.code : e);
    }
  }
  throw kino.error("unavailable", ultimoError);
}

function direccionDe(e) {
  const url = String((e && (e.url_resolved || e.url)) || "").trim();
  return /^https?:\/\//i.test(url) ? url : "";
}

function crearCanal(e, categoria, titulo, prefijo) {
  const url = direccionDe(e);
  if (!url) return null;
  const sello = String(e.stationuuid || plano(titulo)).replace(/[^A-Za-z0-9._~-]/g, "-").slice(0, 100);
  const canal = {
    id: prefijo + "-" + sello,
    title: titulo.slice(0, 200),
    categoryId: categoria.id,
    stream: { url },
  };
  const logo = String(e.favicon || "").trim();
  if (/^https?:\/\//i.test(logo)) canal.logo = logo;
  return canal;
}

// Categoría con todas las emisoras que devuelva la consulta (las más escuchadas primero).
function canalesDeConsulta(emisoras, categoria) {
  const vistos = new Set();
  const canales = [];
  for (const e of emisoras) {
    const nombre = String((e && e.name) || "").replace(/\s+/g, " ").trim();
    if (!nombre) continue;
    // Emisoras repetidas con el mismo nombre: queda la más escuchada (viene primero).
    const clave = plano(nombre);
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    const canal = crearCanal(e, categoria, nombre, categoria.id);
    if (canal) canales.push(canal);
  }
  canales.sort(compararNombres);
  return canales;
}

// Radios sueltas con dirección propia (las que no están en el directorio).
function canalesExtras(extras, categoria) {
  const canales = [];
  for (const x of extras) {
    const url = String((x && x.url) || "").trim();
    const titulo = String((x && x.titulo) || "").replace(/\s+/g, " ").trim();
    if (!titulo || !/^https?:\/\//i.test(url)) continue;
    const canal = {
      id: categoria.id + "-extra-" + plano(titulo).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90),
      title: titulo.slice(0, 200),
      categoryId: categoria.id,
      stream: { url },
    };
    const logo = String((x && x.logo) || "").trim();
    if (/^https?:\/\//i.test(logo)) canal.logo = logo;
    canales.push(canal);
  }
  return canales;
}

// ---------- Radio Garden (radios de una ciudad) ----------

// Recorre un JSON entero y llama a "fn" con cada objeto que encuentre, sin importar cómo venga armado.
function recorrer(nodo, fn, nivel) {
  const n = nivel || 0;
  if (!nodo || typeof nodo !== "object" || n > 12) return;
  if (Array.isArray(nodo)) {
    for (const x of nodo) recorrer(x, fn, n + 1);
    return;
  }
  fn(nodo);
  for (const k of Object.keys(nodo)) recorrer(nodo[k], fn, n + 1);
}

async function pedirJsonRadioGarden(ruta) {
  const r = await kino.fetch(RADIO_GARDEN + ruta, {
    headers: { Accept: "application/json", "User-Agent": "Kino-Radio/0.5" },
    timeoutMs: 8000,
  });
  if (!r.ok) throw kino.error("unavailable", "Radio Garden respondió " + r.status);
  return r.json();
}

// Busca la ciudad en Radio Garden (la guarda 30 días) y devuelve sus radios.
async function radiosDeRadioGarden(categoria) {
  const ciudad = categoria.radioGarden;
  const memoriaCiudad = "rg-ciudad-" + plano(ciudad).replace(/[^a-z0-9]+/g, "-");
  let lugar = kino.storage.get(memoriaCiudad);
  if (!lugar) {
    const hallazgos = [];
    recorrer(await pedirJsonRadioGarden("/api/search?q=" + encodeURIComponent(ciudad)), (o) => {
      const m = /\/visit\/[^/]+\/([A-Za-z0-9_-]+)\/?$/.exec(String(o.url || ""));
      if (m) hallazgos.push({ id: m[1], texto: plano(String(o.title || "") + " " + String(o.subtitle || "")) });
    });
    const nombre = plano(ciudad);
    const pais = categoria.country === "BO" ? "bolivia" : "";
    const elegido =
      hallazgos.find((h) => h.texto.includes(nombre) && (!pais || h.texto.includes(pais))) ||
      hallazgos.find((h) => h.texto.includes(nombre));
    if (!elegido) throw kino.error("not_found", "Radio Garden no encontró " + ciudad);
    lugar = elegido.id;
    kino.storage.set(memoriaCiudad, lugar, { ttlMs: TREINTA_DIAS });
  }
  const radios = [];
  const vistas = new Set();
  recorrer(await pedirJsonRadioGarden("/api/ara/content/page/" + encodeURIComponent(lugar) + "/channels"), (o) => {
    const m = /^\/listen\/[^/]+\/([A-Za-z0-9_-]+)\/?$/.exec(String(o.url || ""));
    const titulo = String(o.title || "").replace(/\s+/g, " ").trim();
    if (!m || !titulo || vistas.has(m[1])) return;
    vistas.add(m[1]);
    radios.push({
      id: categoria.id + "-rg-" + m[1],
      title: titulo.slice(0, 200),
      categoryId: categoria.id,
      // Radio Garden redirige a la transmisión real de la radio.
      stream: { url: RADIO_GARDEN + "/api/ara/content/listen/" + m[1] + "/channel.mp3" },
    });
  });
  return radios;
}

// Clave para detectar la misma radio escrita distinto en dos fuentes ("Radio Activa" y "Radio Activa 91.9 FM").
function claveSimilar(titulo) {
  return plano(titulo)
    .replace(/\b\d+([.,]\d+)?\b/g, " ")
    .replace(/\b(fm|am|radio|bolivia)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Ejecuta las tareas de a pocas a la vez (Kino permite 6 peticiones en vuelo).
async function enLotes(tareas, tamano) {
  const salida = [];
  for (let i = 0; i < tareas.length; i += tamano) {
    const resultados = await Promise.all(tareas.slice(i, i + tamano).map((t) => t()));
    for (const r of resultados) salida.push(r);
  }
  return salida;
}

// Una emisora de Radio Disney por país: la más escuchada del directorio que lleve "Disney" en el nombre.
async function canalesDisney(categoria) {
  const tareas = categoria.disney.map((pais) => async () => {
    try {
      const emisoras = await pedirEmisoras({ countrycode: pais.codigo, name: "Radio Disney", limit: 10 });
      return emisoras.find((e) => /disney/.test(plano(e && e.name)) && direccionDe(e)) || null;
    } catch (e) {
      kino.log("Radio Disney " + pais.titulo + " falló: " + e);
      return null;
    }
  });
  const encontradas = await enLotes(tareas, 6);
  const canales = [];
  categoria.disney.forEach((pais, i) => {
    const e = encontradas[i];
    if (!e) {
      kino.log("No encontré Radio Disney en " + pais.titulo);
      return;
    }
    const canal = crearCanal(e, categoria, "Radio Disney " + pais.titulo, categoria.id);
    if (canal) canales.push(canal);
  });
  canales.sort(compararNombres);
  return canales;
}

async function cargarCategoria(categoria) {
  await null;
  const guardado = memoria[categoria.id];
  if (guardado && Date.now() - guardado.hora < DIEZ_MINUTOS) return guardado.canales;

  let canales;
  if (categoria.disney) {
    canales = await canalesDisney(categoria);
    if (!canales.length) throw kino.error("unavailable", "no encontré emisoras de Radio Disney");
  } else if (categoria.radioGarden) {
    // Las dos fuentes van a la vez y si una falla, la otra sigue sirviendo.
    const [delDirectorio, deRadioGarden] = await Promise.all([
      pedirEmisoras(categoria.consulta).catch((e) => {
        kino.log("Falló el directorio: " + e);
        return [];
      }),
      radiosDeRadioGarden(categoria).catch((e) => {
        kino.log("Falló Radio Garden: " + e);
        return [];
      }),
    ]);
    const sueltas = canalesExtras(categoria.extras || [], categoria);
    // Orden de prioridad si una radio sale repetida: las sueltas, luego Radio Garden, luego el directorio.
    const vistas = new Set();
    canales = [];
    for (const c of sueltas.concat(deRadioGarden, canalesDeConsulta(delDirectorio, categoria))) {
      const clave = claveSimilar(c.title) || plano(c.title);
      if (vistas.has(clave)) continue;
      vistas.add(clave);
      canales.push(c);
    }
    canales.sort(compararNombres);
    if (!canales.length) throw kino.error("unavailable", "no pude leer las radios de " + categoria.titulo);
  } else {
    const emisoras = await pedirEmisoras(categoria.consulta);
    canales = canalesDeConsulta(emisoras, categoria);
    if (!canales.length) throw kino.error("unavailable", "sin emisoras para " + categoria.titulo);
  }
  memoria[categoria.id] = { canales, hora: Date.now() };
  return canales;
}

// ---------- Lo que Kino llama ----------

// Las categorías no necesitan internet: siempre aparecen.
export async function liveCategories() {
  await null;
  return CATEGORIAS.map((c) => {
    const cat = { id: c.id, title: c.titulo };
    if (c.country) cat.country = c.country;
    return cat;
  });
}

export async function liveChannels(args) {
  await null;
  const categoryId = args && args.categoryId;
  const categoria = CATEGORIAS.find((c) => c.id === categoryId);
  if (!categoria) return { items: [] };
  return { items: await cargarCategoria(categoria) };
}

// Kino exige home o search; este plugin solo tiene canales en vivo.
export async function home() {
  await null;
  return [];
}

// Las emisoras traen su dirección directa y no llaman a resolve.
export async function resolve() {
  await null;
  throw kino.error("not_found");
}
