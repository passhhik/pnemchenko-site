// Интерактивная 3D-голова: взгляд за курсором, моргание, рот, резиновое растягивание, снимаемые очки.
// Деформация считается в вершинном шейдере как гладкое поле смещений в пространстве головы:
// все меши (кожа, глаза, зубы, очки) деформируются одним полем, поэтому голова тянется
// как единое целое и внутренности никогда не видны.
// Three.js лежит на сайте (vendor/three) и подключается относительными путями — без CDN и без import map
import * as THREE from '../vendor/three/three.module.js';
import { makeBrain } from './brain.js';
// Загрузчик модели (GLTFLoader, распаковщик сеток) подключается в load(): мозгу, с которого начинается сборка, он не нужен,
// а весит как шестая часть движка — без него мозг появляется раньше.

const NH = 4;                    // одновременных «щипков» (мультитач)
const SIG_MIN = 0.22;            // радиус щипка в покое, в единицах головы (ширина головы ≈ 1.5)
const JELLY = 0.42;              // доля широкого «желейного» слоя в растяжении
const R_MAX = 1.25;              // резиновый предел: чем дальше тянешь, тем туже
const PIVOT = new THREE.Vector3(0, -0.62, -0.05);   // шея — точка поворота головы
const FIT_H = 2.1, FIT_W = 1.62;
const CORNER_FIT = 0.86;         // какую долю кружка в углу занимает голова (по макету)
// Габариты и силуэт головы, пока модель не загрузилась: по ним камера сразу встаёт верно, и мозг (он появляется первым,
// ещё до модели) не «прыгает», когда модель приходит. Числа сняты с assets/head.glb; после загрузки они уточняются
// по самой модели — если модель заметно изменят, обновите их (см. _measureHead и _measureSilhouette).
const DEFAULT_BOX = { cx: 0, cy: -0.131, w: 1.603, h: 2.248 };
const DEFAULT_SIL = { xr: 0.7348, zr: -0.0741, xl: -0.731, zl: -0.0185, yt: 0.904, zt: 0.3049, yb: -0.9276, zb: 0.5203, w: 1.4658, zx: -0.0463, ar: 1.3281 };
const EYE_FAR = 9;               // глаза сводятся на далёкой точке по линии взгляда — без косоглазия
const EYE_YAW = 0.3, EYE_UP = 0.1, EYE_DOWN = 0.2;   // пределы поворота глаз, рад (≈17° / 6° / 11°)
// Эффект присутствия на телефоне (датчик наклона). Телефон — коробка с головой внутри, зритель стоит на месте.
// depth  — «объём»: повернул телефон — видишь голову чуть сбоку, как любой объёмный предмет в руке (0 — плоская картинка, 1 — как настоящий);
// follow — «доворот»: какую часть этого поворота голова отыгрывает обратно, поворачиваясь к зрителю (за ~полсекунды);
// roll   — «крен»: насколько голова остаётся вертикальной, когда телефон заваливают набок.
// Глаза при этом всегда смотрят в камеру — то есть на зрителя. Значения подбираются на телефоне ползунками (адрес …/?diag).
export const TILT = { depth: 0.6, follow: 0.4, roll: 0.7 };
const TILT_SETTLE = 6;           // телефон замер в новой позе — за столько секунд она становится «прямо перед зрителем»
const TILT_LEASH = 0.8;          // дальше этого угла (рад) от опорной позы голова не «помнит» зрителя: поза подтягивается следом
const TILT_ROLL_LEASH = 0.35;    // то же для оси, вдоль которой меряется крен
// Мягкие пределы поворота головы от наклона, рад. Чуть шире пределов глаз (EYE_*): дальше глаза не дотянутся до зрителя
const TILT_YAW = 0.34, TILT_DOWN = 0.14, TILT_UP = 0.24, TILT_ROLL = 0.42;
const GLASSES_HOLD = 4200;       // сколько очки висят там, где их отпустили, прежде чем голова наденет их сама, мс
// Плевок: где голова «берётся» сама за себя (координаты головы) и радиус щипка — две щеки и губы
const SPIT_AT = [[0.33, -0.52, 0.5, 0.2], [-0.33, -0.52, 0.5, 0.2], [0.005, -0.6, 0.8, 0.14]];
const SPIT_MOUTH = [0.005, -0.6, 0.92];   // откуда вылетает плевок
// Очки сдвинуты с носа дальше этого — значит, сняты: рисуются поверх головы целиком (не проваливаются в лицо)
const GLASSES_ON_TOP = 0.06;
// Сборка головы при загрузке. Первым появляется мозг со стикерами — сразу, пока ещё качается модель: он и есть «загрузка».
// Когда модель готова (и мозг повисел хотя бы brainMin секунд), по расписанию выскакивают остальные части — секунды
// от этого момента: глаза, рот изнутри (дёсны с языком, верхние зубы, нижние — и один раз клацают), очки (надеваются
// спереди), пирсинг — и в конце снизу вверх «нарастает» кожа и закрывает мозг.
const INTRO = { brainMin: 0.5, eyes: 0, gums: 0.34, teeth: 0.52, clack: [0.96], glasses: 1.08, septum: 1.36, cuff: 1.48, skin: 1.62, skinDur: 0.95 };
const INTRO_ZOOM = 0.94;         // голова собирается чуть «издалека» и к концу сборки подплывает на своё место
// Зубы в модели — с корнями; без кожи корни торчат из дёсен. Пока идёт сборка, от зубов оставляем коронки:
// [z не глубже, y не выше, y не ниже] в координатах головы (в покое).
const TEETH_CLIP = [0.43, -0.42, -0.7];
const GUMS_TOP = -0.41;

// Все параметры «света и кожи» в одном месте. Два пресета; сравнить можно параметром адреса:
// http://localhost:8765/?look=cinema — прежний «киношный» вариант.
const PRESETS = {
  // «Фотосвет» (по умолчанию): текстура снята с фото и уже содержит мягкий студийный свет, поэтому
  // 3D-свет лишь слегка лепит форму — ровная заливка + ключ справа, без плёночной кривой.
  photo: {
    toneMapping: THREE.LinearToneMapping,
    exposure: 1.0,
    hemi: [0xffffff, 0xffffff, 1.1],          // ровная заливка
    key: [0xffffff, 1.8, [3.0, 1.0, 4.0]],     // ключ справа от зрителя, чуть выше глаз
    fill: [0xffffff, 0.0, [-2.5, 1.5, 5.0]],
    rim: [0xffffff, 0.2, [2.4, 2.8, -4.0]],
    rim2: [0xffffff, 0.0, [-3.4, 0.8, -2.4]],   // цветной контровой от фона (см. setSceneColor)
    skin: {
      rough: 0.6, env: 0.1, glow: 0,
      tint: [0.84, 1.0, 1.07],                 // баланс белого: кожа без «оранжевости»
      sat: 1.0,
      wrap: [0.22, 0.09, 0.055],               // «подповерхностное» тепло: свет заворачивает за границу тени, красный дальше
      hair: 0.58,                              // яркость волос и бровей (1 — как в текстуре)
      keyTint: [1.0, 1.0, 1.0], ambTint: [1.0, 1.0, 1.0],   // оттенок прямого и рассеянного света на коже
      sheen: 0.45,                             // бархатистый блик кожи (сильнее в Т-зоне), 0 — матовая
      blush: 1.0,                              // живые цветовые зоны: щёки, кончик носа, уши чуть краснее
      lips: 0,                                 // губы: 0 — как на фото, матовые; 1 — чуть ярче и с влажным бликом
      hairShine: 1.0,                          // блики вдоль прядей волос
      rim: 0.15,                               // край силуэта ловит цвет фона сцены
      photo: 1.0,                              // центр лица (нос, вокруг рта) — с настоящей фотографии
    },
    eyes: { white: 0.8, glow: 0.18, shadow: 0.65,  // белизна белков, их подсветка и плотность теней вокруг глаз
      catch: 1.0, iris: 1.0, limbus: 1.0 },       // блик-отражение, яркость радужки, тёмный ободок радужки
    shadows: 0.85,                               // мягкие тени от оправы и пирсинга на лице (0 — выкл)
    metal: { color: 0xe4e6ea, rough: 0.08, env: 1.2 }, // полированное серебро оправы и пирсинга
    sceneRim: 1.1,                             // сила цветного контрового света от фона
  },
  // «Кино»: плёночная кривая ACES, мягкий ключ сверху-слева, контровые — более «3D», но кожа бледнее.
  cinema: {
    toneMapping: THREE.ACESFilmicToneMapping,
    exposure: 0.82,
    hemi: [0xf4f1ec, 0x5d5047, 0.5],
    key: [0xffffff, 2.8, [-1.2, 2.2, 5.0]],
    fill: [0xeef2fb, 0.45, [3.0, 0.2, 3.6]],
    rim: [0xffffff, 1.7, [2.4, 2.8, -4.0]],
    rim2: [0xfff0e2, 0.7, [-3.2, 1.2, -3.2]],
    skin: {
      rough: 0.56, env: 0.75, glow: 0.03,
      tint: [1.02, 1.0, 0.9], sat: 0.92, wrap: [0.25, 0.12, 0.08], hair: 1.0,
      keyTint: [1.0, 1.0, 1.0], ambTint: [1.0, 1.0, 1.0],
      sheen: 0.3, blush: 0.6, lips: 0.6, hairShine: 0.8, rim: 0.15, photo: 1.0,
    },
    eyes: { white: 0.5, glow: 0, shadow: 1, catch: 0.8, iris: 0.6, limbus: 0.6 },
    shadows: 0.6,
    metal: { color: 0xd4d6da, rough: 0.2, env: 1.0 },
    sceneRim: 0.7,
  },
};
const lookParam = (() => { try { return new URLSearchParams(location.search).get('look'); } catch (_) { return null; } })();
export const LOOK = PRESETS[lookParam] || PRESETS.photo;

const SQUISH_GLSL = /* glsl */`
#define SQ_N ${NH}
uniform vec3 uSqC[SQ_N];
uniform vec3 uSqD[SQ_N];
uniform vec3 uSqE[SQ_N];
uniform float uSqS[SQ_N];
uniform float uSqW[SQ_N];
uniform float uSqA[SQ_N];
uniform mat4 uObjToHead;
uniform mat4 uHeadToObj;
// Два гауссовых слоя на каждый щипок: узкий держит точку под пальцем, широкий «желейный»
// запаздывает и колышется. Плюс лёгкое сужение «шейки» у вытянутой части.
// J — якобиан поля: нужен, чтобы корректно повернуть нормали и свет на растянутой коже.
vec3 squishField(vec3 p, out mat3 J) {
  vec3 d = vec3(0.0);
  J = mat3(1.0);
  for (int i = 0; i < SQ_N; i++) {
    vec3 D = uSqD[i];
    vec3 E = uSqE[i];
    float LD = length(D);
    if (LD + length(E) < 1e-5) continue;
    vec3 r = p - uSqC[i];
    float rr = dot(r, r);
    float s2 = uSqS[i] * uSqS[i];
    float w = exp(-rr / (2.0 * s2));
    vec3 gw = -w * r / s2;
    d += D * w;
    J += outerProduct(D, gw);
    float q2 = uSqW[i] * uSqW[i];
    float we = exp(-rr / (2.0 * q2));
    d += E * we;
    J += outerProduct(E, -we * r / q2);
    float a = uSqA[i];
    if (a > 0.0 && LD > 1e-5) {
      vec3 u = D / LD;
      vec3 rp = r - dot(r, u) * u;
      d -= a * w * rp;
      J -= a * (outerProduct(rp, gw) + w * (mat3(1.0) - outerProduct(u, u)));
    }
  }
  return d;
}
`;

// Фото-накладка: губы и зона под глазами берутся с фотографии (как в Blender), остальное — из текстуры.
const FACE_VERT = /* glsl */`
attribute vec2 aFaceUv;
varying vec2 vFaceUv;
varying vec3 vRest;
varying vec3 vRestN;
varying vec3 vHairT;
`;
const FACE_FRAG = /* glsl */`
uniform sampler2D uFaceMap;
uniform vec3 uSkinKeyTint;
uniform vec3 uSkinAmbTint;
uniform vec3 uSkinWrap;
uniform float uHairTone;
uniform float uSkinSat;
uniform vec3 uSkinTint;
uniform float uSkinGlow;
uniform float uSkinSheen;
uniform float uBlush;
uniform float uLips;
uniform float uHairShine;
uniform vec3 uRimColor;
uniform float uRimK;
uniform float uPhotoCenter;
uniform float uReveal;
varying vec2 vFaceUv;
varying vec3 vRest;
varying vec3 vRestN;
varying vec3 vHairT;
// зоны лица (в координатах головы), считаются один раз в color_fragment и дальше используются в свете
float sqLum = 0.5;       // яркость текстуры до тонировки: волосы и брови — тёмные
float sqHairM = 0.0;     // маска волос (для бликов вдоль прядей)
vec3 sqHairT = vec3(0.0, 1.0, 0.0);   // направление прядей (в пространстве камеры)
float sqTZ = 0.0;        // Т-зона: лоб, спинка и кончик носа, подбородок
float sqLipM = 0.0;      // губы
float sqSkinM = 1.0;     // «чистая» кожа: светлая и насыщенная (седые и смешанные пиксели у висков — не кожа)
float sqShineM = 0.0;    // где волосам можно бликовать: макушка и затылок; виски и бакенбарды — нет (иначе «седина»)
float sqEll(vec3 p, vec3 c, vec3 r) { vec3 d = (p - c) / r; return 1.0 - smoothstep(0.3, 1.0, dot(d, d)); }
float lipMask(vec3 p) {
  float dx = (p.x - 0.005) / 0.20;
  float dz = p.y + 0.59;
  float b = dz > 0.0 ? 0.075 : 0.09;
  float rho = pow(pow(abs(dx), 3.0) + pow(abs(dz / b), 3.0), 1.0 / 3.0);
  return 1.0 - smoothstep(0.85, 1.25, rho);
}
float underEyeMask(vec3 p, vec2 c) {
  float dx = (p.x - c.x) / 0.15;
  float dz = (p.y - (c.y - 0.06)) / 0.08;
  float rho = pow(pow(abs(dx), 2.5) + pow(abs(dz), 2.5), 0.4);
  float lid = c.y - 0.0284 + 0.02 * pow((p.x - c.x) / 0.075, 2.0);   // линия нижнего века
  return (1.0 - smoothstep(0.72, 1.12, rho)) * (1.0 - smoothstep(lid - 0.014, lid - 0.002, p.y));
}
float lipCore(vec3 p) {   // только сами губы, без кожи вокруг
  float dx = (p.x - 0.005) / 0.20;
  float dz = p.y + 0.59;
  float b = dz > 0.0 ? 0.075 : 0.09;
  float rho = pow(pow(abs(dx), 3.0) + pow(abs(dz / b), 3.0), 1.0 / 3.0);
  return (1.0 - smoothstep(0.55, 0.85, rho)) * step(0.3, p.z);
}
float faceMask(vec3 p, vec3 n, vec2 fuv) {
  if (p.z < 0.3 || p.y > -0.02 || p.y < -0.84 || abs(p.x) > 0.41) return 0.0;   // вне фото-зон
  float m = max(lipMask(p), max(underEyeMask(p, vec2(-0.2238, -0.1116)), underEyeMask(p, vec2(0.2228, -0.1132))));
  // центр лица с фото: нос ниже носоупоров и зона вокруг рта — там снимок чистый и даёт живую кожу (поры, щетину)
  float c = max(sqEll(p, vec3(0.017, -0.35, 0.8), vec3(0.13, 0.16, 0.34)), sqEll(p, vec3(0.01, -0.57, 0.7), vec3(0.27, 0.2, 0.36)));
  c *= smoothstep(0.2, 0.5, n.z) * (1.0 - smoothstep(0.86, 0.95, fuv.y));   // не тянем фото на боковые грани и за край снимка
  return max(m, c * uPhotoCenter) * step(0.3, p.z);
}
`;

// Кожа: тёплый прямой свет с мягким терминатором (красный канал заворачивает за границу света дальше),
// а на волосах — два блика вдоль прядей (модель Kajiya–Kay): белый узкий и широкий цветной.
const SKIN_LIGHTS = THREE.ShaderChunk.lights_physical_pars_fragment
  .replace('vec3 irradiance = dotNL * directLight.color;', `vec3 irradiance = dotNL * directLight.color;
	vec3 sqWrap = saturate( ( vec3( dot( geometryNormal, directLight.direction ) ) + uSkinWrap ) / ( 1.0 + uSkinWrap ) ) * directLight.color;`)
  .replace('reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
    `reflectedLight.directDiffuse += sqWrap * uSkinKeyTint * BRDF_Lambert( material.diffuseColor );
	if ( sqShineM > 0.001 && uHairShine > 0.0 ) {
		vec3 sqH = normalize( directLight.direction + geometryViewDir );
		vec3 sqT1 = normalize( sqHairT + geometryNormal * 0.12 );
		vec3 sqT2 = normalize( sqHairT - geometryNormal * 0.18 );
		float sqD1 = dot( sqT1, sqH ), sqD2 = dot( sqT2, sqH );
		float sqK1 = pow( sqrt( max( 0.0, 1.0 - sqD1 * sqD1 ) ), 90.0 );
		float sqK2 = pow( sqrt( max( 0.0, 1.0 - sqD2 * sqD2 ) ), 32.0 );
		float sqWr = saturate( ( dot( geometryNormal, directLight.direction ) + 0.25 ) / 1.25 );
		// блик — на тёмных и средних прядях; светлые пиксели у висков (смесь кожи и волос) не бликуют — иначе «седина»
		float sqStrand = smoothstep( 0.015, 0.1, sqLum ) * ( 1.0 - smoothstep( 0.17, 0.3, sqLum ) );
		float sqFront = smoothstep( -0.1, 0.35, dot( directLight.direction, geometryViewDir ) );   // только свет спереди
		vec3 sqSpec = sqK1 * vec3( 0.16 ) + sqK2 * material.diffuseColor * 1.3;
		reflectedLight.directSpecular += directLight.color * sqWr * sqShineM * uHairShine * sqStrand * sqFront * sqSpec;
	}`);

// Рот: чем глубже, тем темнее (свет туда почти не попадает).
const MOUTH_FRAG = /* glsl */`
uniform float uMouthOpen;
uniform float uReveal;
varying vec3 vMouthP;
varying vec3 vMouthR;
float mouthOcc(vec3 p) {
  float depth = smoothstep(0.34, 0.8, p.z);
  float side = 1.0 - 0.45 * smoothstep(0.1, 0.24, abs(p.x));
  return mix(0.035, 1.0, pow(depth, 1.7)) * side * mix(0.55, 1.0, smoothstep(0.0, 0.7, uMouthOpen));
}
`;

// Глаза: белки светлее, радужка ярче с тёмным ободком, блик-отражение софтбокса на роговице.
// Центр и радиусы — из текстуры глаза (зрачок r≈0.041, край радужки r≈0.098 в UV).
const EYE_FRAG = /* glsl */`
uniform float uScleraWhite;
uniform float uEyeGlow;
uniform float uCatch;
uniform float uIris;
uniform float uLimbus;
const vec2 SQ_EYE_C = vec2(0.5013, 0.4996);
float sqCatch(vec3 r, vec3 l, vec2 size) {
  vec3 u = normalize(cross(vec3(0.0, 1.0, 0.0), l));
  vec3 w = cross(l, u);
  vec2 q = vec2(dot(r, u), dot(r, w)) / size;
  // скруглённый прямоугольник: так бликует софтбокс, а не точечная лампа
  vec2 a = abs(q);
  float d = length(max(a - vec2(0.55), 0.0)) + min(max(a.x - 0.55, a.y - 0.55), 0.0);
  return (1.0 - smoothstep(0.22, 0.5, d)) * step(0.0, dot(r, l));   // мягкий край, без «пиксельной» ступеньки
}
`;

// Стёкла и прозрачные носоупоры: почти невидимы в лоб, отражают по краям и в бликах (Френель).
const LENS_FRAG = /* glsl */`
uniform vec2 uLensA;
`;

// Мягкая тень от оправы и пирсинга: 16 точек Пуассона с поворотом на каждый пиксель — полутень как от софтбокса,
// без «лесенки» стандартного PCF. Тени отбрасывают только очки и пирсинг, поэтому кожа не затеняет сама себя
// (светотень лица уже есть в текстуре).
const SOFT_SHADOW_GLSL = /* glsl */`
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
float sqSoftShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
  shadowCoord.xyz /= shadowCoord.w;
  shadowCoord.z += shadowBias;
  if ( shadowCoord.x < 0.0 || shadowCoord.x > 1.0 || shadowCoord.y < 0.0 || shadowCoord.y > 1.0 || shadowCoord.z > 1.0 ) return 1.0;
  const vec2 PD[16] = vec2[16](
    vec2(-0.94201624, -0.39906216), vec2(0.94558609, -0.76890725), vec2(-0.09418410, -0.92938870), vec2(0.34495938, 0.29387760),
    vec2(-0.91588581, 0.45771432), vec2(-0.81544232, -0.87912464), vec2(-0.38277543, 0.27676845), vec2(0.97484398, 0.75648379),
    vec2(0.44323325, -0.97511554), vec2(0.53742981, -0.47373420), vec2(-0.26496911, -0.41893023), vec2(0.79197514, 0.19090188),
    vec2(-0.24188840, 0.99706507), vec2(-0.81409955, 0.91437590), vec2(0.19984126, 0.78641367), vec2(0.14383161, -0.14100790));
  float a = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) ) * 6.2831853;
  mat2 R = mat2( cos( a ), sin( a ), -sin( a ), cos( a ) );
  vec2 ts = shadowRadius / shadowMapSize;
  float s = 0.0;
  for ( int k = 0; k < 16; k++ ) s += texture2DCompare( shadowMap, shadowCoord.xy + R * PD[ k ] * ts, shadowCoord.z );
  return mix( 1.0, s / 16.0, shadowIntensity );
}
#endif
`;
const withSoftShadow = (fs) => fs
  .replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n' + SOFT_SHADOW_GLSL)
  .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin
    .replace('getShadow( directionalShadowMap[ i ]', 'sqSoftShadow( directionalShadowMap[ i ]'));

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rand = (a, b) => a + Math.random() * (b - a);
const damp = (dt, k) => 1 - Math.exp(-dt * k);
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const vibrate = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (_) { /* noop */ } };

// Студийное окружение для отражений: светлый верх, тёмный низ и три софтбокса.
// Даёт металлу оправы контраст, а глазам — живые блики.
function studioEnvironment(renderer) {
  const scene = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(20, 64, 32), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vD; void main() { vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vD;
      void main() {
        float y = vD.y;
        vec3 top = vec3(0.92, 0.9, 0.87), hor = vec3(0.42, 0.4, 0.38), bot = vec3(0.13, 0.12, 0.11);
        vec3 c = y > 0.0 ? mix(hor, top, smoothstep(0.0, 0.85, y)) : mix(hor, bot, smoothstep(0.0, 0.45, -y));
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  scene.add(sky);
  const panel = (w, h, x, y, z, intensity, tint) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(tint).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); scene.add(m);
  };
  panel(7, 5, -7, 6, 9, 6, 0xfff4e8);    // ключевой софтбокс слева сверху
  panel(2, 9, 10, 1, 4, 2.2, 0xeaf0ff);  // заполняющий стрип справа
  panel(10, 2, 0, 9, -7, 3.5, 0xffffff); // контровой сверху-сзади
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(scene, 0.03).texture;
  pm.dispose();
  scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  return tex;
}

// Окружение «для ювелирки» — только для металла: тёмный пол, светлый верх и узкие яркие стрипы.
// Контраст отражений и даёт металлу живой блеск (без него серебро выглядит матовым пластиком).
function jewelryEnvironment(renderer) {
  const scene = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(20, 64, 32), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vD; void main() { vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vD;
      void main() {
        float y = vD.y;
        vec3 top = vec3(0.95, 0.95, 0.97), mid = vec3(0.55, 0.56, 0.58), hor = vec3(0.1, 0.1, 0.11), bot = vec3(0.02, 0.02, 0.025);
        vec3 c = y > 0.0 ? (y > 0.35 ? mix(mid, top, smoothstep(0.35, 0.9, y)) : mix(hor, mid, smoothstep(0.0, 0.35, y)))
                         : mix(hor, bot, smoothstep(0.0, 0.3, -y));
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  scene.add(sky);
  const panel = (w, h, x, y, z, intensity) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); scene.add(m);
  };
  panel(6, 4, -6, 7, 8, 9);      // большой софтбокс сверху-слева
  panel(1.2, 10, 9, 1, 5, 7);    // узкий стрип справа
  panel(1.2, 10, -10, 0, 2, 4);  // стрип слева
  panel(12, 1.2, 0, 10, -5, 6);  // стрип сверху-сзади
  panel(10, 0.8, 0, -4, 9, 2.5); // тонкий стрип снизу-спереди — подсветка нижних краёв оправы
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(scene, 0.015).texture;
  pm.dispose();
  scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  return tex;
}

export class Head extends EventTarget {
  constructor(container, opts = {}) {
    super();
    this.container = container;
    this.opts = { modelUrl: 'assets/head.glb', faceUrl: opts.lipsUrl || 'assets/face.jpg', reducedMotion: false, ...opts };
    this.rm = !!this.opts.reducedMotion;
    this.mode = 'hero';
    this.onTick = null;       // начало кадра: (dt, now)
    this.onFrame = null;      // всё посчитано, сейчас будет отрисовка — здесь страница узнаёт, где линзы
    this.loaded = false;

    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    // Плотность пикселей холста подстраивается под устройство (см. _adapt): начинаем с лучшей, а если кадры не успевают —
    // снижаем, пока не станет плавно. ratio — текущая, max/min — границы, ema — средняя длительность кадра, мс.
    const dpr = window.devicePixelRatio || 1;
    this.q = { ratio: Math.min(dpr, 1.75), max: Math.min(dpr, 1.75), min: Math.min(dpr, 1), ema: 16, n: 0, hold: 0, upAt: 0, trial: null, upFrom: 0, pinned: false, calm: false, fps: 0, fpsN: 0, fpsT: 0 };
    r.setPixelRatio(this.q.ratio);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = LOOK.toneMapping;
    r.toneMappingExposure = LOOK.exposure;
    this.canvas = r.domElement;
    this.canvas.style.touchAction = 'none';
    container.appendChild(this.canvas);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(26, 1, 0.1, 60);
    this.scene.environment = studioEnvironment(r);
    this.metalEnv = null;             // окружение для металла нужно только модели — считается, когда она пришла (см. load)
    const dl = ([c, i, p]) => { const l = new THREE.DirectionalLight(c, i); l.position.set(...p); return l; };
    this.lights = {
      hemi: new THREE.HemisphereLight(...LOOK.hemi),
      key: dl(LOOK.key), fill: dl(LOOK.fill), rim: dl(LOOK.rim), rim2: dl(LOOK.rim2),
    };
    this.scene.add(...Object.values(this.lights));
    for (const l of Object.values(this.lights)) l.layers.enableAll();   // свет нужен и слою очков
    if (LOOK.shadows > 0) {
      r.shadowMap.enabled = true;
      r.shadowMap.type = THREE.PCFShadowMap;
      const k = this.lights.key;
      k.castShadow = true;
      k.shadow.mapSize.set(1024, 1024);
      Object.assign(k.shadow.camera, { left: -1.15, right: 1.15, top: 1.15, bottom: -1.15, near: 1, far: 10 });
      k.shadow.camera.updateProjectionMatrix();
      k.shadow.bias = -0.0005;
      k.shadow.radius = 3.5;                // полутень в текселях карты теней (~1 мм на лице): тонкая оправа даёт мягкую, но читаемую тень
      k.shadow.intensity = LOOK.shadows;
    }

    this.pivot = new THREE.Group();
    this.pivot.position.copy(PIVOT);
    this.scene.add(this.pivot);

    this.shared = {
      uSqC: { value: Array.from({ length: NH }, () => new THREE.Vector3()) },
      uSqD: { value: Array.from({ length: NH }, () => new THREE.Vector3()) },
      uSqE: { value: Array.from({ length: NH }, () => new THREE.Vector3()) },
      uSqS: { value: new Array(NH).fill(SIG_MIN) },
      uSqW: { value: new Array(NH).fill(SIG_MIN * 2) },
      uSqA: { value: new Array(NH).fill(0) },
    };
    const S = LOOK.skin;
    this.skinU = {
      uSkinKeyTint: { value: new THREE.Vector3(...S.keyTint) },
      uSkinAmbTint: { value: new THREE.Vector3(...S.ambTint) },
      uSkinWrap: { value: new THREE.Vector3(...S.wrap) },
      uHairTone: { value: S.hair },
      uSkinSat: { value: S.sat },
      uSkinTint: { value: new THREE.Vector3(...S.tint) },
      uSkinGlow: { value: S.glow },
      uSkinSheen: { value: S.sheen },
      uBlush: { value: S.blush },
      uLips: { value: S.lips },
      uHairShine: { value: S.hairShine },
      uRimColor: { value: new THREE.Color(0x3a5bff) },
      uRimK: { value: S.rim },
      uPhotoCenter: { value: S.photo ?? 1 },
      uReveal: { value: 10 },          // до какой высоты (в координатах головы) кожа уже «наросла»; 10 — вся на месте
    };
    this.mouthU = { uMouthOpen: { value: 0 }, uReveal: this.skinU.uReveal };
    const E = LOOK.eyes;
    this.eyeU = { uScleraWhite: { value: E.white }, uEyeGlow: { value: E.glow }, uCatch: { value: E.catch }, uIris: { value: E.iris }, uLimbus: { value: E.limbus } };
    this.handles = Array.from({ length: NH }, () => ({
      active: false, grabbed: false,
      c: new THREE.Vector3(), t: new THREE.Vector3(), goal: new THREE.Vector3(),
      d: new THREE.Vector3(), v: new THREE.Vector3(),     // узкий слой
      e: new THREE.Vector3(), ev: new THREE.Vector3(),    // широкий «желейный» слой
    }));
    this.lean = { a: new THREE.Vector3(), v: new THREE.Vector3(), t: new THREE.Vector3() };   // голову «ведёт» за щипком
    this.drags = new Map();
    this.raycaster = new THREE.Raycaster();
    this.pointer = { x: 0, y: 0, has: false, lastMove: performance.now() };
    this.lookOverride = null;
    this.rot = { yaw: 0, pitch: 0 };
    this.mouth = 0; this.mouthTarget = 0;
    this.blink = { next: 1.4, t: -1, double: false };
    this.squint = 0;
    this.pop = { s: this.rm ? 1 : 0.001, v: 0 };
    this.sq = { s: 1, v: 0 };
    this.sacc = { x: 0, y: 0, next: 0 };
    this.glasses = { node: null, home: new THREE.Vector3(), homeQ: new THREE.Quaternion(), homeS: new THREE.Vector3(1, 1, 1), cen: new THREE.Vector3(), pop: 1, popDone: 1,
      offset: new THREE.Vector3(), vel: new THREE.Vector3(), target: new THREE.Vector3(),
      world: new THREE.Vector3(), grabbed: false, holdUntil: 0, off: false, announced: false, selfReturn: false };
    this.blind = 0;                   // 0 — очки на носу, 1 — мир в тумане
    this.ov = null;                   // отдельный холст для снятых очков (см. _ensureOverlay)
    this.glassMeshes = []; this.bodyMeshes = []; this.lensHull = [];
    this.layout = null; this.rect = null; this.headBox = null; this.sil = null; this.aspect = DEFAULT_SIL.ar;
    this.clock = new THREE.Clock();
    this._v = Array.from({ length: 8 }, () => new THREE.Vector3());
    this._n2 = new THREE.Vector2();
    this._a = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._headInv = new THREE.Matrix4();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -2.0);
    // Датчик наклона: эффект присутствия (см. TILT). yaw/pitch/roll — поворот головы от наклона, px/py — сдвиг для слоёв «в глубине»
    this.tiltCfg = { ...TILT };
    this.tilt = { on: false, has: false, n: 0, q: new THREE.Quaternion(), base: null, last: new THREE.Quaternion(), lastMove: 0, announced: false,
      prev: new THREE.Quaternion(), slow: new THREE.Quaternion(), speed: 0, still: 0, w: 0, ty: 0, tp: 0, lean: 0,
      fy: 0, fvy: 0, fp: 0, fvp: 0, fr: 0, fvr: 0, yaw: 0, pitch: 0, roll: 0, px: 0, py: 0 };
    // сборка при загрузке (см. INTRO): пока она идёт, голова смотрит прямо в экран и не откликается на касания
    // pre — модель ещё качается, виден только мозг; base — в какой момент сборки модель стала готова (от него идёт расписание)
    this.intro = { on: false, pre: false, t: 0, base: null, rate: 1, parts: [], jaw: 0, zoom: 1 };
    this.brain = null; this.brainHold = null;
    this.ready = new Promise((res) => { this._ready = res; });     // голова собрана и готова разговаривать
    this.eyeShadows = [];
    // плевок: фаза (t < 0 — покой), три «своих» щипка (щёки, губы) и пружины рывка головы
    this.spitS = { t: -1, wind: 0.55, fired: false, big: false, amp: 1, side: 1, h: [null, null, null], p: 0, pv: 0, z: 0, zv: 0, r: 0, rv: 0, jaw: 0, squint: 0 };
    this._tq = new THREE.Quaternion(); this._tq2 = new THREE.Quaternion(); this._te = new THREE.Euler();
    this._tq1 = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);   // экран смотрит на зрителя, а не в небо
    this._tz = new THREE.Vector3(0, 0, 1); this._tu = new THREE.Vector3(); this._tup = new THREE.Vector3();
    this._ty = new THREE.Vector3(); this._tc = new THREE.Vector3();

    this._bind();
    this._ro = new ResizeObserver(() => this.frame());
    this._ro.observe(container);
    this.frame();
  }

  // ---------- загрузка ----------
  // intro — показать сборку головы по частям; rate — темп сборки (1 — обычный);
  // data — байты модели (или обещание их): страница начинает качать модель заранее, см. js/model.js. Нет — качаем сами.
  async load(onProgress, { intro = true, rate = 1, data = null } = {}) {
    if (intro && !this.rm && this.mode !== 'corner') this._preIntro(rate);      // мозг — сразу, пока качается модель
    // Окружение для металла (оправа, пирсинг) считаем, пока модель ещё качается — когда мозг уже на экране и успокоился.
    // Модель пришла раньше — посчитаем перед материалами (ниже).
    const warmMetal = setTimeout(() => { if (!this.metalEnv && !this.loaded) this.metalEnv = jewelryEnvironment(this.renderer); }, 700);
    const bytes = data ? Promise.resolve(data) : null;
    if (bytes) bytes.catch(() => {});                      // ошибку обработаем ниже — здесь только чтобы она не осталась «ничьей»
    let gltf, faceTex;
    try {
      const face = new THREE.TextureLoader().loadAsync(this.opts.faceUrl).catch((e) => { console.warn('Фото лица не загрузилось — голова будет без накладки', e); return null; });
      const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
        import('../vendor/three/addons/loaders/GLTFLoader.js'), import('../vendor/three/addons/libs/meshopt_decoder.module.js'),
      ]);
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      const model = bytes
        ? bytes.then((buf) => loader.parseAsync(buf, ''))
        : loader.loadAsync(this.opts.modelUrl, (e) => { if (e.total && onProgress) onProgress(e.loaded / e.total); });
      [gltf, faceTex] = await Promise.all([model, face]);
    } catch (e) {
      // модель не пришла: убираем одинокий мозг и чистим холст — сайт останется без головы
      clearTimeout(warmMetal);
      this.renderer.setAnimationLoop(null);
      this._dropBrain();
      this.intro.on = false; this.intro.pre = false; this.intro.parts.length = 0;
      this.renderer.clear();
      throw e;
    }
    this._emit('model', {});                               // модель скачана и разобрана; дальше — материалы и шейдеры
    clearTimeout(warmMetal);
    if (!this.metalEnv) this.metalEnv = jewelryEnvironment(this.renderer);
    if (faceTex) {
      faceTex.colorSpace = THREE.SRGBColorSpace;
      faceTex.flipY = false;               // UV из glTF: начало координат сверху
      faceTex.anisotropy = 4;
      this.faceU = { uFaceMap: { value: faceTex } };
    }

    this.model = gltf.scene;
    this.model.position.copy(PIVOT).multiplyScalar(-1);
    this.pivot.add(this.model);
    this.root = this.model.getObjectByName('HeadRoot') || this.model;
    this.glasses.node = this.model.getObjectByName('Glasses');
    if (this.glasses.node) { this.glasses.home.copy(this.glasses.node.position); this.glasses.homeQ.copy(this.glasses.node.quaternion); this.glasses.homeS.copy(this.glasses.node.scale); }
    this.eyes = ['Eye_L', 'Eye_R'].map((n) => this.model.getObjectByName(n)).filter(Boolean);
    this.lensHull = this._measureLensHulls();

    this.meshes = []; this.pickables = [];
    this.morphs = { JawOpen: [], Blink_L: [], Blink_R: [] };
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      const base = this._baseName(o);
      o.userData.base = base;
      o.material = this._setupMaterial(o);
      if (LOOK.shadows > 0) {
        const mn = o.material.name || '';
        if (/Silver|Steel|Acetate/.test(mn)) { o.castShadow = true; o.customDepthMaterial = this._depthMaterial(o); }
        if (/^(Head_Skin|Material_0_Patch|Eye_[LR])/.test(mn)) o.receiveShadow = true;
      }
      this.meshes.push(o);
      // слои: 1 — очки, 2 — всё остальное (нужно слою очков только как «заслонка» по глубине)
      o.userData.dw = o.material.depthWrite;
      if (this._isGlasses(o)) { o.layers.enable(1); this.glassMeshes.push(o); }
      else if (!/^EyeShadow/.test(base)) { o.layers.enable(2); this.bodyMeshes.push(o); }
      if (!/^EyeShadow/.test(base)) this.pickables.push(o); else this.eyeShadows.push(o);
      if (o.morphTargetDictionary) {
        for (const k of Object.keys(this.morphs)) {
          const i = o.morphTargetDictionary[k];
          if (i !== undefined) this.morphs[k].push([o, i]);
        }
      }
    });
    // Мерим голову в покое, в полный размер. Пока идёт сборка, она стоит чуть «издалека» (INTRO_ZOOM) — в мерку этот
    // масштаб попасть не должен, иначе камера встанет под уменьшенную голову, и настоящая окажется крупнее своего места.
    const zoom = this.pivot.scale.clone();
    this.pivot.scale.setScalar(1);
    this.scene.updateMatrixWorld(true);
    this.headBox = this._measureHead();
    this.sil = this._measureSilhouette(this.headBox);
    this.pivot.scale.copy(zoom);
    this.scene.updateMatrixWorld(true);
    this._updateMatrices();
    this.aspect = this.sil ? this.sil.ar : this.headBox.h / this.headBox.w;
    this.frame();
    // Шейдеры собираются сейчас — потом сборка пойдёт без рывков. Собираются в фоне, где браузер это умеет: страница
    // (и мозг на экране) в это время не замирает. Модель на это время спрятана: на экране по-прежнему только мозг.
    this.model.visible = false;
    try { await this.renderer.compileAsync(this.scene, this.camera); } catch (_) { this.renderer.compile(this.scene, this.camera); }
    this.model.visible = true;
    // пока модель качалась и собиралась, могли уйти в каталог (сборка отменена) — тогда голова появляется сразу целой
    const assemble = this.intro.on && this.intro.pre && this.mode !== 'corner';
    if (assemble) { this.root.add(this.brain); this.pivot.remove(this.brainHold); this.brainHold = null; this.scene.updateMatrixWorld(true); }   // мозг переезжает в саму голову
    else this._dropBrain();
    this.loaded = true;
    this.clock.getDelta();
    this.q.hold = performance.now() + 2500;              // первые секунды устройство «прогревается» — плотность пикселей пока не трогаем
    if (assemble) this._startIntro(); else { this.intro.on = false; this.intro.pre = false; this.intro.parts.length = 0; this._ready(); }
    this._loop();
    this._warmOverlay();
    return this;
  }

  // Слой для снятых очков готовим заранее — чтобы не было рывка, когда их стянут с носа. Но не посреди сборки головы
  // и не посреди реплики (создание второго холста — заметная пауза на телефоне), а когда голова собралась и секунду
  // молчит. На слабых устройствах (мало памяти, режим экономии трафика) — только когда очки действительно взяли.
  _warmOverlay() {
    const weak = (navigator.deviceMemory && navigator.deviceMemory <= 2) || (navigator.connection && navigator.connection.saveData);
    if (weak) return;
    let since = 0;
    const check = () => {
      if (this.ov || this._ovFailed) return;
      const now = performance.now();
      const quiet = !this.intro.on && !this.drags.size && this.spitS.t < 0 && this.mouthTarget < 0.004 && this.mouth < 0.02 && !document.hidden;
      since = quiet ? (since || now) : 0;
      if (since && now - since > 900) this._ensureOverlay(); else setTimeout(check, 300);
    };
    this.ready.then(() => setTimeout(check, 1200));
  }

  // Рамка геометрии головы (без очков и пирсинга): на её центр смотрит камера
  _measureHead() {
    const box = new THREE.Box3(), tmp = new THREE.Box3();
    for (const o of this.meshes || []) {
      if (this._isGlasses(o) || /^(EyeShadow|Piercing)/.test(o.userData.base || '')) continue;
      o.geometry.computeBoundingBox();
      tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      box.union(tmp);
    }
    if (box.isEmpty()) return DEFAULT_BOX;
    const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
    return { cx: c.x, cy: c.y, w: sz.x, h: sz.y };
  }

  // Силуэт головы в покое, каким его видит камера: крайние точки (уши, макушка, подбородок) и их глубина.
  // Рамка геометрии для этого не годится: в ней запас под раскрытый рот, а уши стоят дальше плоскости лица
  // и в перспективе выходят у́же. По силуэту голова занимает на главной ровно отведённое ей место.
  _measureSilhouette(B) {
    const z0 = 7.5;                      // типичное расстояние камеры на главной; крайние точки от него почти не зависят
    const v = new THREE.Vector3(), S = {};
    let r = -Infinity, l = Infinity, t = -Infinity, b = Infinity;
    for (const o of this.meshes || []) {
      if (this._isGlasses(o) || /^(EyeShadow|Piercing)/.test(o.userData.base || '')) continue;
      const pos = o.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        const d = z0 - v.z;
        if (d <= 0.1) continue;
        const ax = (v.x - B.cx) / d, ay = (v.y - B.cy) / d;
        if (ax > r) { r = ax; S.xr = v.x; S.zr = v.z; }
        if (ax < l) { l = ax; S.xl = v.x; S.zl = v.z; }
        if (ay > t) { t = ay; S.yt = v.y; S.zt = v.z; }
        if (ay < b) { b = ay; S.yb = v.y; S.zb = v.z; }
      }
    }
    if (!(r > l) || !(t > b)) return null;
    S.w = S.xr - S.xl;                   // от уха до уха
    S.zx = (S.zr + S.zl) / 2;            // на какой глубине стоят уши
    S.ar = (t - b) / (r - l);            // видимые пропорции: высота к ширине
    return S;
  }

  // Контур каждой линзы в координатах узла Glasses: выпуклая оболочка её вершин (алгоритм Эндрю),
  // чуть ужатая к центру — граница резкого и размытого прячется под ободком оправы.
  _measureLensHulls() {
    const g = this.glasses.node;
    if (!g) return [];
    let src = g.getObjectByName('Glasses_Lenses') || null;
    if (src && !src.isMesh) { let m = null; src.traverse((o) => { if (o.isMesh && !m) m = o; }); src = m; }
    if (!src || !src.isMesh) return [];
    g.updateWorldMatrix(true, true);
    const rel = new THREE.Matrix4().copy(g.matrixWorld).invert().multiply(src.matrixWorld);
    const pos = src.geometry.getAttribute('position');
    const sides = [[], []];
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(rel); sides[v.x < 0 ? 0 : 1].push(v.clone()); }
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    return sides.filter((pts) => pts.length > 2).map((pts) => {
      pts.sort((a, b) => a.x - b.x || a.y - b.y);
      const lower = [], upper = [];
      for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
      for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
      let hull = lower.slice(0, -1).concat(upper.slice(0, -1));
      const step = Math.ceil(hull.length / 40);
      if (step > 1) hull = hull.filter((_, i) => i % step === 0);
      const c = hull.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / hull.length);
      return hull.map((p) => p.clone().sub(c).multiplyScalar(0.965).add(c));
    });
  }

  // Контуры линз на экране (CSS-пиксели окна) — по ним в размытии страницы вырезаются «окна»
  lensOutlines() {
    const g = this.glasses.node;
    if (!g || !this.lensHull.length) return [];
    const r = this.canvas.getBoundingClientRect(), cam = this.camera, v = this._v[5], out = [];
    for (const hull of this.lensHull) {
      const poly = [];
      for (const p of hull) {
        v.copy(p).applyMatrix4(g.matrixWorld).project(cam);
        if (!(v.z > -1 && v.z < 1)) { poly.length = 0; break; }
        poly.push([r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]);
      }
      if (poly.length > 2) out.push(poly);
    }
    return out;
  }

  // ---------- снятые очки: отдельный холст поверх страницы ----------
  // Когда очки сняты, страница размыта. Чтобы сами очки оставались резкими и их можно было унести в любой угол
  // экрана (в каталоге и кейсе голова живёт в маленьком кружке), они рисуются вторым холстом во всё окно —
  // поверх размытия. На основном холсте в это время от очков остаётся только тень на лице.
  _ensureOverlay() {
    if (this.ov || this._ovFailed || !this.loaded || !this.glassMeshes.length) return this.ov;
    try {
      const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.toneMapping = LOOK.toneMapping;
      r.toneMappingExposure = LOOK.exposure;
      r.setClearColor(0x000000, 0);
      r.autoClear = false;
      const c = r.domElement;
      c.className = 'glasses-layer';
      c.setAttribute('aria-hidden', 'true');
      c.style.display = 'none';
      document.body.appendChild(c);
      this.ov = { r, c, cam: new THREE.PerspectiveCamera(), env: studioEnvironment(r), metalEnv: jewelryEnvironment(r), w: 0, h: 0, on: false };
      for (const o of this.bodyMeshes) o.userData.depthOnly = this._depthOnly(o);
      this._renderOverlay(true);       // прогрев: шейдеры собираются сейчас, а не в момент, когда очки сняли
    } catch (e) {
      console.warn('Слой для снятых очков недоступен — очки останутся на основном холсте', e);
      this._ovFailed = true; this.ov = null;
    }
    return this.ov;
  }

  // Материал «только глубина» для головы на слое очков: пока очки на носу, дужка за ухом должна остаться закрытой
  _depthOnly(mesh) {
    const m = new THREE.MeshBasicMaterial({ colorWrite: false });
    const u = mesh.userData.sqU, shared = this.shared;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, shared, u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + SQUISH_GLSL)
        .replace('#include <morphtarget_vertex>', `#include <morphtarget_vertex>
          { vec3 hp = (uObjToHead * vec4(transformed, 1.0)).xyz; mat3 J; vec3 dsp = squishField(hp, J);
            transformed = (uHeadToObj * vec4(hp + dsp, 1.0)).xyz; }`);
    };
    m.customProgramCacheKey = () => 'squish-depthonly';
    return m;
  }

  _setOverlay(on) {
    const ov = this.ov;
    if (!ov || ov.on === on) return;
    ov.on = on;
    ov.c.style.display = on ? '' : 'none';
    for (const o of this.glassMeshes) { o.material.colorWrite = !on; o.material.depthWrite = on ? false : o.userData.dw; }
  }

  _renderOverlay(warm = false) {
    const ov = this.ov;
    if (!ov) return;
    const W = document.documentElement.clientWidth, H = document.documentElement.clientHeight;
    if (ov.w !== W || ov.h !== H) { ov.w = W; ov.h = H; ov.r.setSize(W, H, false); }
    // та же камера, но кадр — всё окно: очки стоят ровно там же, где стояли бы на основном холсте
    const src = this.camera, cam = ov.cam, v = src.view;
    const cr = this.canvas.getBoundingClientRect();
    cam.position.copy(src.position); cam.quaternion.copy(src.quaternion);
    cam.fov = src.fov; cam.aspect = src.aspect; cam.near = src.near; cam.far = src.far;
    cam.setViewOffset(v.fullWidth, v.fullHeight, v.offsetX - cr.left, v.offsetY - cr.top, W, H);
    const r = ov.r, key = this.lights.key, cast = key.castShadow, env = this.scene.environment;
    key.castShadow = false;
    this.scene.environment = ov.env;
    r.clear();
    // 1) голова — только в буфер глубины: пока очки на носу, она закрывает дужки за ушами. Стоит очки стянуть —
    //    голову на этом слое не рисуем вовсе, и очки идут поверх неё целиком: перед лицом они не проваливаются в нос и щёки.
    if (warm || this.glasses.offset.length() <= GLASSES_ON_TOP) {
      cam.layers.set(2);
      for (const o of this.bodyMeshes) { o.userData.mat = o.material; o.material = o.userData.depthOnly; }
      r.render(this.scene, cam);
      for (const o of this.bodyMeshes) o.material = o.userData.mat;
    }
    // 2) сами очки
    cam.layers.set(1);
    for (const o of this.glassMeshes) { const m = o.material; m.colorWrite = true; m.depthWrite = o.userData.dw; if (m.userData.metal) m.envMap = ov.metalEnv; }
    r.render(this.scene, cam);
    for (const o of this.glassMeshes) {
      const m = o.material;
      if (m.userData.metal) m.envMap = this.metalEnv;
      if (!warm) { m.colorWrite = false; m.depthWrite = false; }
    }
    this.scene.environment = env;
    key.castShadow = cast;
  }

  _baseName(o) {
    let n = o;
    while (n.parent && n.parent !== this.root && n.parent !== this.glasses.node && n.parent !== this.model) n = n.parent;
    return (n.name || '').replace(/\d+$/, '');
  }

  _isGlasses(o) {
    for (let n = o; n; n = n.parent) if (n === this.glasses.node) return true;
    return false;
  }

  _setupMaterial(mesh) {
    const src = mesh.material;
    const mn = src.name || '';
    const S = LOOK.skin;
    let m = src.clone();
    const f = { skin: false, face: false, mouth: false, lips: false, teeth: false, lens: null, eye: false };
    if (/^(Head_Skin|Material_0_Patch)/.test(mn)) {
      f.skin = true;
      f.face = !!this.faceU && !!mesh.geometry.getAttribute('uv1');
      m.color.set(0xffffff); m.roughness = S.rough; m.metalness = 0; m.envMapIntensity = S.env;
      m.emissive = new THREE.Color(0x000000); m.emissiveMap = null;
    } else if (/^(MouthInterior|MouthCavity|Mouth_GumsTongue)/.test(mn)) {
      f.mouth = true;
      f.lips = !/Gums/.test(mn);          // изнанка губ и «мешок» рта — часть лица: при сборке появляются вместе с кожей
      m.color.set(0xffffff); m.roughness = 0.42; m.metalness = 0; m.envMapIntensity = 0.3;
    } else if (/^Mouth_Teeth/.test(mn)) {
      f.mouth = true; f.teeth = true;
      m.color.set(0xe2dccd); m.roughness = 0.32; m.metalness = 0; m.envMapIntensity = 0.45;
    } else if (/^Eye_[LR]/.test(mn)) {
      m.color.set(0xffffff); m.roughness = 0.1; m.metalness = 0; m.envMapIntensity = 0.9;
      m.emissive = new THREE.Color(0x000000); m.emissiveMap = null;
      f.eye = true;
    } else if (/^EyeShadow/.test(mn)) {
      m.transparent = true; m.depthWrite = false; m.roughness = 1; m.envMapIntensity = 0; mesh.renderOrder = 2;
      m.opacity = LOOK.eyes.shadow;
    } else if (/Lens/.test(mn)) {
      m = new THREE.MeshStandardMaterial({ color: 0x000000, metalness: 0, roughness: 0.05, transparent: true, envMapIntensity: 1.5, depthWrite: false });
      m.name = mn; mesh.renderOrder = 3; f.lens = new THREE.Vector2(0.03, 0.42);
    } else if (/PadClear/.test(mn)) {
      m = new THREE.MeshStandardMaterial({ color: 0x8e9092, metalness: 0, roughness: 0.12, transparent: true, envMapIntensity: 1.3, depthWrite: false });
      m.name = mn; mesh.renderOrder = 3; f.lens = new THREE.Vector2(0.14, 0.62);
    } else if (/Acetate/.test(mn)) {
      m.color.set(0x1b1b1f); m.metalness = 0; m.roughness = 0.3;
    } else if (/Silver|Steel/.test(mn)) {
      const M = LOOK.metal;
      m.color.set(M.color); m.metalness = 1; m.roughness = M.rough; m.envMap = this.metalEnv; m.envMapIntensity = M.env;
      m.userData.metal = true;
    }
    m.vertexColors = !!mesh.geometry.getAttribute('color') && /^(Head_Skin|Material_0_Patch|Mouth)/.test(mn);
    if (f.face) mesh.geometry.setAttribute('aFaceUv', mesh.geometry.getAttribute('uv1'));
    this._patch(m, mesh, f);
    return m;
  }

  _depthMaterial(mesh) {
    const dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    const u = mesh.userData.sqU, shared = this.shared;
    dm.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, shared, u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + SQUISH_GLSL)
        .replace('#include <morphtarget_vertex>', `#include <morphtarget_vertex>
          { vec3 hp = (uObjToHead * vec4(transformed, 1.0)).xyz; mat3 J; vec3 dsp = squishField(hp, J);
            transformed = (uHeadToObj * vec4(hp + dsp, 1.0)).xyz; }`);
    };
    dm.customProgramCacheKey = () => 'squish-depth';
    return dm;
  }

  _patch(m, mesh, f) {
    const u = { uObjToHead: { value: new THREE.Matrix4() }, uHeadToObj: { value: new THREE.Matrix4() } };
    mesh.userData.sqU = u;
    const shared = this.shared;
    const lensU = f.lens ? { uLensA: { value: f.lens } } : null;
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, shared, u,
        f.skin ? this.skinU : {}, f.face ? this.faceU : {}, f.mouth ? this.mouthU : {}, lensU || {}, f.eye ? this.eyeU : {});
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + SQUISH_GLSL + (f.skin ? FACE_VERT : '') + (f.mouth ? 'varying vec3 vMouthP;\nvarying vec3 vMouthR;\n' : ''))
        .replace('#include <defaultnormal_vertex>', '')
        .replace('#include <normal_vertex>', '')
        .replace('#include <morphtarget_vertex>', `#include <morphtarget_vertex>
          ${f.skin ? `
          // точка и нормаль «в покое» в координатах головы — маски лица от них не зависят от того,
          // как упакована модель (например, сжата meshopt с квантованием координат)
          vRest = (uObjToHead * vec4(position, 1.0)).xyz;
          vRestN = normalize(mat3(uObjToHead) * objectNormal);
          ${f.face ? 'vFaceUv = aFaceUv;' : ''}
          {
            // пряди зачёсаны назад: направление «назад и чуть вверх», спроецированное на поверхность
            vec3 sqTo = vec3(0.0, 0.15, -1.0);
            vec3 sqTt = sqTo - vRestN * dot(sqTo, vRestN);
            vHairT = normalize((modelViewMatrix * vec4(mat3(uHeadToObj) * sqTt, 0.0)).xyz + 1e-5);
          }` : ''}
          {
            vec3 hp = (uObjToHead * vec4(transformed, 1.0)).xyz;
            ${f.mouth ? 'vMouthP = hp; vMouthR = (uObjToHead * vec4(position, 1.0)).xyz;' : ''}
            mat3 J;
            vec3 dsp = squishField(hp, J);
            transformed = (uHeadToObj * vec4(hp + dsp, 1.0)).xyz;
            vec3 nh = mat3(uObjToHead) * objectNormal;
            nh = transpose(inverse(J)) * nh;
            objectNormal = normalize(mat3(uHeadToObj) * nh);
          }
          #include <defaultnormal_vertex>
          #include <normal_vertex>`);
      let fs = shader.fragmentShader;
      if (f.skin || f.eye) fs = withSoftShadow(fs);
      if (f.skin) {
        fs = fs
          .replace('#include <common>', '#include <common>\n' + FACE_FRAG)
          .replace('#include <lights_physical_pars_fragment>', SKIN_LIGHTS)
          .replace('#include <color_fragment>', `
            // сборка при загрузке: кожа «нарастает» снизу вверх, край чуть неровный
            float sqRv = uReveal + 0.03 * sin(vRest.x * 9.0 + vRest.z * 6.0) - vRest.y;
            if (sqRv < 0.0) discard;
            totalEmissiveRadiance += vec3(1.0, 0.62, 0.58) * (1.0 - smoothstep(0.0, 0.09, sqRv)) * 0.5;      // свежий край кожи чуть светится
            #include <color_fragment>
            ${f.face ? `{
              float sqM = faceMask(vRest, normalize(vRestN), vFaceUv);
              diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uFaceMap, vFaceUv).rgb, sqM);
            }` : ''}
            {
              vec3 p = vRest;
              float sqL = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
              sqLum = sqL;
              {
                float mx = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)), mn = min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));
                sqSkinM = smoothstep(0.24, 0.38, sqL) * smoothstep(0.14, 0.28, (mx - mn) / max(mx, 1e-3));
              }
              // зоны: лицо ниже линии роста волос, волосы (тёмное вне лица), губы, Т-зона, «кровяные» зоны
              float sqFace = step(0.25, p.z) * (1.0 - smoothstep(0.58, 0.66, p.y)) * (1.0 - smoothstep(0.46, 0.52, abs(p.x)));
              sqHairM = (1.0 - smoothstep(0.07, 0.2, sqL)) * (1.0 - sqFace);
              float sqSide = smoothstep(0.36, 0.5, abs(p.x)) * (1.0 - smoothstep(0.3, 0.55, p.y)) * smoothstep(-0.5, -0.2, p.z);
              sqShineM = smoothstep(0.7, 0.95, sqHairM) * (1.0 - sqSide);
              sqLipM = lipCore(p);
              float sqCheek = max(sqEll(p, vec3(0.34, -0.37, 0.56), vec3(0.17, 0.14, 0.22)), sqEll(p, vec3(-0.34, -0.37, 0.56), vec3(0.17, 0.14, 0.22)));
              float sqNose = sqEll(p, vec3(0.017, -0.33, 0.8), vec3(0.085, 0.075, 0.14));
              float sqEar = max(sqEll(p, vec3(0.66, -0.15, -0.12), vec3(0.14, 0.3, 0.3)), sqEll(p, vec3(-0.66, -0.15, -0.12), vec3(0.14, 0.3, 0.3)));
              sqTZ = clamp(sqEll(p, vec3(0.0, 0.33, 0.62), vec3(0.3, 0.27, 0.3)) + sqEll(p, vec3(0.017, -0.12, 0.74), vec3(0.06, 0.26, 0.16))
                         + sqNose + sqEll(p, vec3(0.02, -0.86, 0.5), vec3(0.14, 0.1, 0.22)), 0.0, 1.0) * (1.0 - sqHairM);
              diffuseColor.rgb = mix(vec3(sqL), diffuseColor.rgb, uSkinSat) * uSkinTint;
              diffuseColor.rgb *= mix(uHairTone, 1.0, smoothstep(0.05, 0.2, sqL));   // волосы и брови — темнее
              // живые зоны: щёки, кончик носа и уши краснее — там кровь ближе к поверхности
              float sqBl = clamp(sqCheek * 0.5 + sqNose * 0.45 + sqEar * 0.6, 0.0, 1.0) * uBlush * (1.0 - sqHairM);
              diffuseColor.rgb *= mix(vec3(1.0), vec3(1.0, 0.9, 0.885), sqBl);
              // губы: насыщеннее и чуть розовее
              float sqLl = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
              diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(sqLl), diffuseColor.rgb, 1.12) * vec3(1.02, 0.97, 0.98), sqLipM * uLips);
            }`)
          .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
            reflectedLight.indirectDiffuse *= uSkinAmbTint;   // холодная заливка теней
            #ifdef USE_ENVMAP
            {
              // бархатистый блик: отражение студии с шероховатостью кожи — сильнее в Т-зоне, на губах и под скользящим углом
              float sqRg = mix(0.54, 0.44, sqTZ);
              vec3 sqRad = getIBLRadiance(geometryViewDir, geometryNormal, sqRg) / max(envMapIntensity, 1e-3);
              float sqNoV = saturate(dot(geometryNormal, geometryViewDir));
              float sqF = min(0.028 + 0.972 * pow(1.0 - sqNoV, 5.0), 0.14);   // без белёсого ореола по краю
              reflectedLight.indirectSpecular += sqRad * sqF * uSkinSheen * sqSkinM * mix(0.45, 0.8, sqTZ)
                * mix(1.0 - sqLipM, 1.0 + 1.5 * sqLipM, uLips) * smoothstep(-0.6, 0.2, geometryNormal.y);
            }
            #endif`)
          .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
            // волосы и брови (тёмные участки текстуры) — матовые, без пластиковых бликов
            roughnessFactor = mix(0.9, roughnessFactor, smoothstep(0.05, 0.2, dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722))));
            roughnessFactor = mix(roughnessFactor, 0.47, sqTZ * min(uSkinSheen * 2.0, 1.0));   // Т-зона чуть блестит
            roughnessFactor = mix(roughnessFactor, 0.3, sqLipM * uLips);                       // губы влажные`)
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
            totalEmissiveRadiance += diffuseColor.rgb * uSkinGlow;
            sqHairT = normalize(vHairT - normal * dot(vHairT, normal) + 1e-5);
            {
              // край силуэта ловит цвет фона: голова «сидит» в цветной сцене
              // фон — позади и по бокам: цвет ловят грани, повёрнутые вбок, а не подбородок снизу
              float sqNv = saturate(dot(normal, normalize(vViewPosition)));
              float sqSide = smoothstep(0.25, 0.75, abs(normal.x) / max(length(normal.xy), 1e-3)) * smoothstep(-0.5, 0.1, normal.y);
              totalEmissiveRadiance += uRimColor * uRimK * pow(1.0 - sqNv, 4.0) * sqSide * sqSkinM;
            }`);
      }
      if (f.mouth) {
        fs = fs
          .replace('#include <common>', '#include <common>\n' + MOUTH_FRAG)
          .replace('#include <color_fragment>', `
            ${f.lips ? '// сборка при загрузке: изнанка губ нарастает вместе с кожей (см. uReveal)\n            if (vMouthP.y > uReveal + 0.03 * sin(vMouthP.x * 9.0 + vMouthP.z * 6.0)) discard;' : ''}
            ${f.teeth ? `// пока кожи нет, зубы видны «в покое» только там, где их видно в улыбке: без корней и дальних коренных
            if (uReveal < 5.0 && (vMouthR.z < ${TEETH_CLIP[0]} || vMouthR.y > ${TEETH_CLIP[1]} || vMouthR.y < ${TEETH_CLIP[2]})) discard;` : ''}
            ${f.mouth && !f.lips && !f.teeth ? `// у дёсен при сборке срезаем верхние «уголки» — тонкие складки, которые без щёк торчат рожками
            if (uReveal < 5.0 && vMouthR.y > ${GUMS_TOP}) discard;` : ''}
            #include <color_fragment>`)
          .replace('#include <opaque_fragment>', 'outgoingLight *= mouthOcc(vMouthP);\n#include <opaque_fragment>');
      }
      if (f.eye) {
        fs = fs
          .replace('#include <common>', '#include <common>\n' + EYE_FRAG)
          .replace('#include <color_fragment>', `#include <color_fragment>
            {
              float sqR = distance(vMapUv, SQ_EYE_C);
              // белок в текстуре пыльно-розовый: высветляем всё за краем радужки, сохраняя лёгкий рисунок
              float sqL = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
              float sqW = smoothstep(0.15, 0.25, sqL) * smoothstep(0.098, 0.106, sqR) * uScleraWhite;
              vec3 sqWhite = vec3(0.84, 0.82, 0.79) * clamp(sqL / 0.3, 0.8, 1.1);
              diffuseColor.rgb = mix(diffuseColor.rgb, sqWhite, sqW);
              // радужка ярче и насыщеннее, по краю — тёмный лимбальный ободок (делает взгляд живым и «молодым»)
              float sqIr = smoothstep(0.038, 0.047, sqR) * (1.0 - smoothstep(0.088, 0.1, sqR));
              float sqLb = smoothstep(0.084, 0.096, sqR) * (1.0 - smoothstep(0.099, 0.108, sqR));
              vec3 sqC = diffuseColor.rgb;
              float sqCl = dot(sqC, vec3(0.2126, 0.7152, 0.0722));
              sqC = mix(vec3(sqCl), sqC, 1.0 + 0.55 * uIris * sqIr) * (1.0 + 0.32 * uIris * sqIr);
              diffuseColor.rgb = sqC * (1.0 - 0.45 * uLimbus * sqLb);
            }`)
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
            totalEmissiveRadiance += diffuseColor.rgb * uEyeGlow;`)
          .replace('#include <opaque_fragment>', `{
            // блик-отражение: большой софтбокс сверху-слева и узкий стрип справа
            vec3 sqRf = reflect(-normalize(vViewPosition), normalize(normal));
            float sqK = sqCatch(sqRf, normalize(vec3(-0.24, 0.22, 0.94)), vec2(0.13, 0.1))
                      + 0.3 * sqCatch(sqRf, normalize(vec3(0.62, 0.12, 0.77)), vec2(0.05, 0.13));
            outgoingLight += vec3(1.0, 0.985, 0.96) * sqK * uCatch;
          }
          #include <opaque_fragment>`);
      }
      if (f.lens) {
        fs = fs
          .replace('#include <common>', '#include <common>\n' + LENS_FRAG)
          .replace('#include <opaque_fragment>', `{
            float sqF = pow(1.0 - saturate(abs(dot(normalize(normal), normalize(vViewPosition)))), 4.0);
            float sqH = saturate((dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722)) - 0.35) * 0.9);
            diffuseColor.a = saturate(mix(uLensA.x, uLensA.y, sqF) + sqH);
          }
          #include <opaque_fragment>`);
      }
      shader.fragmentShader = fs;
    };
    const key = `squish${f.skin ? '-skin' : ''}${f.face ? '-face' : ''}${f.mouth ? '-mouth' : ''}${f.lips ? '-lips' : ''}${f.teeth ? '-teeth' : ''}${f.mouth && !f.lips && !f.teeth ? '-gums' : ''}${f.lens ? '-lens' : ''}${f.eye ? '-eye' : ''}`;
    m.customProgramCacheKey = () => key;
    m.needsUpdate = true;
  }

  // ---------- кадрирование ----------
  // На главном экране голову ставит приложение: setLayout({ cx, cy, width }) в CSS-пикселях —
  // центр головы и её ширина (по ушам). В каталоге и кейсе сцена сжимается в кружок в углу, и голова вписана в него.
  // Пока сцена едет в угол или обратно, голова летит по прямой между этими двумя положениями и плавно меняет размер.
  frame() {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    // Размер самого холста (буфера) меняем редко: смена размера стоит дорого и очищает холст. Пока сцена едет в угол
    // или обратно, её рамка меняется каждый кадр — буфер при этом не трогаем: растущей сцене сразу даём полный размер,
    // сжимающаяся дорисовывается в прежнем, а когда рамка замерла — подгоняем точно. Картинка от этого не страдает:
    // холст всегда растянут по рамке, а камера считается от рамки, не от буфера.
    let resized = false;
    if (w !== this._fw || h !== this._fh) {
      this._fw = w; this._fh = h;
      clearTimeout(this._bt);
      if (w > (this._bw || 0) || h > (this._bh || 0)) {
        const full = this.mode !== 'corner';
        this._bw = full ? Math.max(w, window.innerWidth) : w; this._bh = full ? Math.max(h, window.innerHeight) : h;
        this.renderer.setSize(this._bw, this._bh, false); resized = true;
      } else if (w !== this._bw || h !== this._bh) {
        this._bt = setTimeout(() => {
          if (this._fw === this._bw && this._fh === this._bh) return;
          this._bw = this._fw; this._bh = this._fh;
          this.renderer.setSize(this._bw, this._bh, false);
          if (this.loaded) this.renderer.render(this.scene, this.camera);
        }, 180);
      }
    }
    const cam = this.camera;
    cam.aspect = w / h;
    const tan = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const B = this.headBox || DEFAULT_BOX;
    const L = this.layout && this.layout.width > 0 ? this.layout : null;
    const fit = (cw, ch) => Math.min((CORNER_FIT * ch) / FIT_H, (CORNER_FIT * cw) / FIT_W);   // пикселей на единицу головы, когда она вписана в кружок cw×ch
    // t: 0 — сцена во весь экран (главная), 1 — сжалась в кружок
    const C = L && this.cornerRect ? this.cornerRect() : null;
    const vw = document.documentElement.clientWidth || w;
    let t = this.mode === 'corner' || !L ? 1 : 0;
    if (C && C.width > 0 && vw > C.width + 1) t = clamp((vw - w) / (vw - C.width), 0, 1);
    const f = h / (2 * tan);            // пикселей на единицу длины на расстоянии 1 от камеры
    // Главная. Куда поставить ось камеры (hx, hy) и какой взять масштаб hk (пикселей на единицу в плоскости лица),
    // чтобы силуэт от уха до уха занял ровно L.width пикселей, а его середина встала в точку (L.cx, L.cy)
    const S = this.sil || DEFAULT_SIL;
    let hx = 0, hy = 0, hk = 1, hh = 0;
    if (L) {
      if (S) {
        const z = S.zx + (f * S.w) / L.width;
        const right = (S.xr - B.cx) / (z - S.zr), left = (B.cx - S.xl) / (z - S.zl);
        const top = (S.yt - B.cy) / (z - S.zt), bot = (B.cy - S.yb) / (z - S.zb);
        hx = L.cx - (f * (right - left)) / 2; hy = L.cy + (f * (top - bot)) / 2;
        hk = f / z; hh = f * (top + bot);
      } else { hx = L.cx; hy = L.cy; hk = L.width / B.w; hh = L.width * (B.h / B.w); }
    }
    let px, py, k;
    if (t > 0.999) {
      k = fit(w, h);
      px = w / 2 + B.cx * k; py = h / 2 - (B.cy - 0.02) * k;
    } else if (t < 0.001) {
      px = hx; py = hy; k = hk;
    } else {
      const cr = this.container.getBoundingClientRect();
      const kc = fit(C.width, C.height);
      const ex = C.left + C.width / 2 + B.cx * kc, ey = C.top + C.height / 2 - (B.cy - 0.02) * kc;
      px = hx + (ex - hx) * t - cr.left; py = hy + (ey - hy) * t - cr.top; k = hk + (kc - hk) * t;
    }
    cam.position.set(B.cx, B.cy, f / k);
    cam.lookAt(B.cx, B.cy, 0);
    cam.setViewOffset(w, h, Math.round(w / 2 - px), Math.round(h / 2 - py), w, h);
    if (this.mode !== 'corner' && L) {
      this.rect = { x: L.cx - L.width / 2, y: L.cy - hh / 2, w: L.width, h: hh };     // место головы на главной (для раскладки работ вокруг неё)
    } else this.rect = null;
    cam.updateProjectionMatrix();
    this._plane.constant = -2.0;
    // Холст после смены размера пуст. ResizeObserver срабатывает уже после кадра анимации,
    // поэтому рисуем сразу — иначе голова мигала бы, пока сцена едет в угол и обратно.
    if (resized && this.loaded) this.renderer.render(this.scene, this.camera);
  }

  setLayout(l) { this.layout = l; if (this.mode !== 'corner') this.frame(); }
  setMode(mode) { this.mode = mode; this._stir = performance.now() + 900; if (mode === 'corner' && this.intro.on) this._endIntro(); this.frame(); }
  setMouth(v) { this.mouthTarget = clamp(v, 0, 1); }
  lookAtClient(x, y) { this.lookOverride = { x, y }; }
  clearLook() { this.lookOverride = null; }
  boing(a = 0.06) { this.sq.v -= a * 14; }
  // Цвет сцены: мягкий контровой свет цвета фона — голова «сидит» в сцене, а не наклеена поверх
  setSceneColor(hex) {
    const l = this.lights && this.lights.rim2;
    if (!l) return;
    this._sceneTo = new THREE.Color(hex);
    if (!this._sceneFrom) { l.color.copy(this._sceneTo); l.intensity = LOOK.sceneRim; this.skinU.uRimColor.value.copy(this._sceneTo); }
  }

  // ---------- гироскоп (телефон) ----------
  enableTilt() {
    if (this.tilt.on) return;
    this.tilt.on = true;
    const reset = () => { this.tilt.base = null; };
    window.addEventListener('deviceorientation', (e) => this._tiltEvent(e));
    window.addEventListener('orientationchange', reset);
    if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', reset);
    document.addEventListener('visibilitychange', reset);
  }

  _tiltEvent(e) {
    if (e.alpha == null && e.beta == null && e.gamma == null) return;   // ноутбук без датчиков
    this.tilt.n++; this.tilt.a = e.alpha; this.tilt.b = e.beta; this.tilt.g = e.gamma;   // сырые углы — для справки ?diag
    const d = THREE.MathUtils.DEG2RAD;
    const orient = (((screen.orientation && screen.orientation.angle) ?? window.orientation) || 0) * d;
    // поза телефона в мире: оси как у камеры — x вправо по экрану, y вверх, z из экрана на зрителя
    const q = this._tq.setFromEuler(this._te.set((e.beta || 0) * d, (e.alpha || 0) * d, -(e.gamma || 0) * d, 'YXZ'));
    q.multiply(this._tq1).multiply(this._tq2.setFromAxisAngle(this._tz, -orient));
    if (!Number.isFinite(q.x + q.y + q.z + q.w)) return;  // датчик прислал мусор
    const t = this.tilt;
    t.q.copy(q);
    if (!t.base) {                                       // первая поза (или экран перевернули): зритель — прямо перед экраном
      t.base = q.clone(); t.last.copy(q); t.prev.copy(q); t.slow.copy(q); t.has = true;
      t.fy = t.fp = t.fvy = t.fvp = 0; t.still = 0;
      return;
    }
    if (t.last.angleTo(q) > 0.03) {                     // ~1,7°: заметное движение, а не дрожание рук
      t.last.copy(q); t.lastMove = performance.now();
      if (!t.announced && t.base.angleTo(q) > 0.2) { t.announced = true; this._emit('tiltstart', {}); }
    }
  }

  // Эффект присутствия. Голова «закреплена» в телефоне, зритель неподвижен. Телефон повернули — зритель видит голову
  // сбоку (depth), она доворачивается к нему обратно (follow), крен гасит (roll). Глаза всё это время смотрят в камеру
  // (см. _updateLook): на плоском экране взгляд «в камеру» — это взгляд на зрителя под любым углом.
  _updateTilt(dt) {
    const t = this.tilt, C = this.tiltCfg;
    // в углу (каталог, кейс) голова маленькая и наклон ей ни к чему: эффект плавно гаснет и возвращается на главной
    const live = t.has && !!t.base && !this.intro.on && this.mode !== 'corner';
    t.w += ((live ? 1 : 0) - t.w) * damp(dt, 3);         // включается и выключается плавно
    if (!t.has || !t.base) return;
    // 1. Опорная поза — та, в которой зритель прямо перед экраном. Пока телефон крутят, она почти не меняется;
    //    телефон замер — новая поза за несколько секунд становится опорной (человек пересел, лёг, перехватил телефон).
    const moved = t.prev.angleTo(t.q); t.prev.copy(t.q);
    t.speed += ((dt > 0 ? moved / dt : 0) - t.speed) * damp(dt, 8);
    t.still = t.speed < 0.2 ? t.still + dt : 0;
    t.base.slerp(t.q, damp(dt, t.still > 1.2 ? 1 / TILT_SETTLE : 1 / 15));
    const off = t.base.angleTo(t.q);
    if (off > TILT_LEASH) t.base.slerp(t.q, 1 - TILT_LEASH / off);
    // 2. Где зритель в осях экрана: u = q⁻¹ · base · (0, 0, 1). ty > 0 — правее нормали к экрану, tp > 0 — выше.
    const inv = this._tq2.copy(t.q).invert();
    const u = this._tu.set(0, 0, 1).applyQuaternion(t.base).applyQuaternion(inv);
    const a = damp(dt, 40);
    t.ty += (Math.atan2(u.x, u.z) - t.ty) * a;
    t.tp += (Math.atan2(u.y, Math.hypot(u.x, u.z)) - t.tp) * a;
    // 3. Крен — насколько телефон завален набок в глазах зрителя. Зритель смотрит вдоль оси v, «верх» для него — верх мира
    //    (сила тяжести); сравниваем с ним длинную сторону экрана — обе в проекции на плоскость, перпендикулярную взгляду.
    //    Ось v — своя опора, медленная и на коротком поводке: когда наклонённый телефон поворачивают «дверью», голова не
    //    должна крениться, а когда человек сам повернулся вместе с телефоном — должна быстро это забыть.
    //    Телефон лежит на столе или повёрнут набок (читают лёжа, альбомный разворот) — крен не трогаем.
    t.slow.slerp(t.q, damp(dt, 1 / 15));
    const offS = t.slow.angleTo(t.q);
    if (offS > TILT_ROLL_LEASH) t.slow.slerp(t.q, 1 - TILT_ROLL_LEASH / offS);
    const v = this._tup.set(0, 0, 1).applyQuaternion(t.slow);
    const U = this._tu.set(0, 1, 0).addScaledVector(v, -v.y);                               // верх мира
    const Y = this._ty.set(0, 1, 0).applyQuaternion(t.q); Y.addScaledVector(v, -Y.dot(v));  // длинная сторона экрана
    t.lean = -Math.atan2(v.dot(this._tc.crossVectors(U, Y)), U.dot(Y));
    const lean = t.lean * smoothstep(0.3, 0.55, U.length()) * smoothstep(0.3, 0.55, Y.length()) * (1 - smoothstep(0.6, 1.0, Math.abs(t.lean)));
    // 4. Голова догоняет зрителя как живая: с разгоном и торможением, без рывка (пружина без колебаний)
    const steps = 2, h = dt / steps, W = 7, WR = 10;
    for (let i = 0; i < steps; i++) {
      t.fvy += ((t.ty - t.fy) * W * W - 2 * W * t.fvy) * h; t.fy += t.fvy * h;
      t.fvp += ((t.tp - t.fp) * W * W - 2 * W * t.fvp) * h; t.fp += t.fvp * h;
      t.fvr += ((lean - t.fr) * WR * WR - 2 * WR * t.fvr) * h; t.fr += t.fvr * h;
    }
    // 5. Итог. Зритель справа — жёстко закреплённую голову он видел бы с её левой стороны: нос уходит влево (−depth · ty);
    //    голова поворачивается к нему (+follow). Зритель сверху — видит макушку, нос вниз (+depth · tp); голова поднимает лицо.
    const soft = (x, m) => m * Math.tanh(x / m);
    const pitch = C.depth * t.tp - C.follow * t.fp;
    t.yaw = soft(-C.depth * t.ty + C.follow * t.fy, TILT_YAW) * t.w;
    t.pitch = soft(pitch, pitch > 0 ? TILT_DOWN : TILT_UP) * t.w;
    t.roll = soft(C.roll * t.fr, TILT_ROLL) * t.w;
    // то, что лежит «в глубине» за головой (логотип), смещается в сторону зрителя: тангенс угла, страница умножит на глубину
    t.px = Math.tan(clamp(t.ty, -0.7, 0.7)) * t.w; t.py = Math.tan(clamp(t.tp, -0.7, 0.7)) * t.w;
  }

  // ---------- сборка при загрузке ----------
  // Мозг появляется сразу — модель ещё качается: он и есть «загрузка». Потом (см. INTRO) каждая часть «выскакивает»
  // из своей середины на пружинке, кожа в конце «нарастает» снизу вверх и прячет мозг. Пока идёт сборка, голова
  // смотрит прямо и не откликается.
  _preIntro(rate) {
    const I = this.intro;
    I.on = true; I.pre = true; I.t = 0; I.base = null; I.rate = rate; I.skin = false; I.zoom = INTRO_ZOOM; I.parts.length = 0;
    const brain = this.brain = makeBrain();
    const hold = this.brainHold = new THREE.Group();
    hold.position.copy(PIVOT).multiplyScalar(-1);            // там же, где встанет модель: мозг сразу на своём месте
    hold.add(brain);
    this.pivot.add(hold);
    const cen = brain.position.clone();
    brain.visible = false;
    I.parts.push({ name: 'brain', at: 0, list: [{ node: brain, pos: cen.clone(), scale: brain.scale.clone(), cen }], s: 0.001, v: 0, k: 150, z: 0.32, shown: false });   // мозг — желе: колышется дольше
    this.skinU.uReveal.value = -10;
    this.pop.s = 1; this.pop.v = 0;                          // голова не «выпрыгивает» целиком — она собирается
    this.pivot.scale.setScalar(I.zoom);
    this.frame();
    this.scene.updateMatrixWorld(true);
    this.clock.getDelta();
    this.renderer.setAnimationLoop(() => this._preTick());
  }

  // кадр, пока модели ещё нет: на сцене только мозг
  _preTick() {
    const real = this.clock.getDelta(), dt = Math.min(real, 1 / 30);
    this._updateIntro(dt, Math.min(real, 0.12));
    this.renderer.render(this.scene, this.camera);
  }

  _dropBrain() {
    if (!this.brain) return;
    if (this.brain.parent) this.brain.parent.remove(this.brain);
    if (this.brainHold) { this.pivot.remove(this.brainHold); this.brainHold = null; }
    this.brain.userData.dispose();
    this.brain = null;
  }

  // модель готова: остальные части встают в очередь за мозгом
  _startIntro() {
    const I = this.intro, model = this.model;
    const named = (n) => model.getObjectByName(n);
    const cenOf = (node) => node.parent.worldToLocal(new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3()));
    I.pre = false;
    const t0 = I.base = Math.max(I.t, INTRO.brainMin);
    const part = (name, at, nodes, o = {}) => {
      const list = nodes.filter(Boolean).map((node) => ({ node, pos: node.position.clone(), scale: node.scale.clone(), cen: cenOf(node) }));
      for (const q of list) q.node.visible = false;
      I.parts.push({ name, at: t0 + at, list, s: 0.001, v: 0, k: o.k || 210, z: o.z || 0.55, shown: false });
    };
    part('eyes', INTRO.eyes, [named('Eye_L')]);
    part('eyes', INTRO.eyes + 0.08, [named('Eye_R')]);
    part('gums', INTRO.gums, [named('Gums_Tongue')]);
    part('teeth', INTRO.teeth, [named('Teeth_Upper')]);
    part('teeth', INTRO.teeth + 0.11, [named('Teeth_Lower')]);
    if (this.glasses.node) { this.glasses.cen.copy(cenOf(this.glasses.node)); part('glasses', INTRO.glasses, [this.glasses.node], { k: 150, z: 0.8 }); }
    part('septum', INTRO.septum, [named('Piercing_Septum')], { k: 320, z: 0.34 });
    part('cuff', INTRO.cuff, [named('Piercing_EarCuff')], { k: 320, z: 0.34 });
    for (const o of this.eyeShadows) o.material.opacity = 0;
  }

  // dt — шаг для пружинок (не больше 1/30 с), real — сколько времени прошло на самом деле: расписание сборки идёт
  // по настоящим часам, чтобы на слабом устройстве с редкими кадрами она не растягивалась
  _updateIntro(dt, real = dt) {
    const I = this.intro;
    if (!I.on) return;
    I.t += real * I.rate;
    const h = dt / 2;
    for (const p of I.parts) {
      if (I.t < p.at) continue;
      if (!p.shown) { p.shown = true; for (const q of p.list) q.node.visible = true; this._emit('introstep', { part: p.name }); }
      if (p.s === 1 && p.v === 0) { if (p.done) continue; p.done = true; }
      else {
        const c = 2 * p.z * Math.sqrt(p.k);
        for (let i = 0; i < 2; i++) { p.v += ((1 - p.s) * p.k - p.v * c) * h; p.s += p.v * h; }
        if (Math.abs(1 - p.s) < 0.002 && Math.abs(p.v) < 0.03) { p.s = 1; p.v = 0; }
      }
      const s = Math.max(0.001, p.s);
      if (p.name === 'glasses') { this.glasses.pop = s; continue; }
      for (const q of p.list) { q.node.scale.copy(q.scale).multiplyScalar(s); q.node.position.copy(q.pos).sub(q.cen).multiplyScalar(s).add(q.cen); }
    }
    // мозг, пока ждёт остальных, слегка покачивается — как желе на блюдце; когда приходит модель, замирает на месте
    if (this.brain) {
      const w = I.base === null ? 1 : 1 - smoothstep(0, 0.45, I.t - I.base), b = I.parts[0];
      this.brain.rotation.set(Math.sin(I.t * 2.3) * 0.045 * w, Math.sin(I.t * 1.5) * 0.17 * w, 0);
      if (b && b.name === 'brain' && b.done) this.brain.position.y = b.list[0].cen.y + Math.sin(I.t * 2.9) * 0.014 * w;
    }
    if (I.base === null) return;                             // модель ещё не пришла — дальше расписания нет
    const T = I.t - I.base, end = INTRO.skin + INTRO.skinDur;
    // вся голова подплывает на место — одним плавным движением на всю сборку
    const zk = clamp(T / end, 0, 1);
    I.zoom = INTRO_ZOOM + (1 - INTRO_ZOOM) * (1 - (1 - zk) ** 3);
    // кожа: край «сборки» поднимается от подбородка к макушке
    const B = this.headBox || DEFAULT_BOX, k = smoothstep(INTRO.skin, end, T);
    const y = B.cy - B.h / 2 - 0.15 + (B.h + 0.35) * k;
    this.skinU.uReveal.value = k > 0 ? y : -10;
    // рот приоткрыт, чтобы было видно зубы; они клацают, а к приходу кожи рот закрывается
    let bite = 0;
    for (const c of INTRO.clack) bite = Math.max(bite, 1 - smoothstep(0.03, 0.1, Math.abs(T - c)));
    I.jaw = 0.5 * smoothstep(INTRO.gums, INTRO.gums + 0.22, T) * (1 - smoothstep(INTRO.skin - 0.34, INTRO.skin - 0.02, T)) * (1 - 0.92 * bite);
    for (const o of this.eyeShadows) o.material.opacity = LOOK.eyes.shadow * smoothstep(-0.3, 0.1, y);
    if (k > 0 && !I.skin) { I.skin = true; this._emit('introstep', { part: 'skin' }); }
    if (T >= end + 0.08) this._endIntro(true);
  }

  // done — сборка дошла до конца сама (а не оборвана уходом в каталог)
  _endIntro(done = false) {
    const I = this.intro;
    if (!I.on) return;
    I.on = false; I.zoom = 1;
    if (I.pre) {                                             // оборвали, пока модель ещё качалась: остался только мозг
      I.pre = false; I.parts.length = 0;
      this.renderer.setAnimationLoop(null);
      this._dropBrain();
      this.pivot.scale.setScalar(1);
      this.skinU.uReveal.value = 10;
      this.renderer.clear();
      return;                                                // голова появится целой, когда модель загрузится (см. load)
    }
    for (const p of I.parts) for (const q of p.list) { q.node.visible = true; q.node.scale.copy(q.scale); q.node.position.copy(q.pos); }
    I.parts.length = 0;
    this.glasses.pop = 1;
    I.jaw = 0;
    this.skinU.uReveal.value = 10;
    for (const o of this.eyeShadows) o.material.opacity = LOOK.eyes.shadow;
    this._dropBrain();                                       // мозг остаётся под кожей только на словах: он больше не виден
    if (done) { this.sq.v -= 0.2; this.blink.next = 0.12; }  // собралась: мягко пружинит и моргает — «я тут»
    this._ready();
    this._emit('introend', {});
  }

  // ---------- плевок ----------
  // Голова набирает в щёки, откидывается назад и резко подаётся вперёд: «тьфу». Потом секунду довольно щурится,
  // склонив голову набок. Щёки и губы — те же резиновые щипки, что и от пальца, только тянет их сама голова.
  // В момент «выстрела» — событие spit с точкой рта на экране.
  // wind — сколько секунд набирает; hark — долгое «хррр»: щёки дрожат, плевок сильнее.
  spit({ wind = 0.55, hark = false } = {}) {
    const s = this.spitS;
    if (!this.loaded || this.rm || (s.t >= 0 && !s.fired)) return false;
    s.t = 0; s.fired = false; s.big = hark; s.wind = wind; s.amp = hark ? 1.25 : 1; s.side = Math.random() < 0.5 ? -1 : 1;
    for (let i = 0; i < 3; i++) {
      let h = s.h[i];
      if (!h || h.owner !== s) {                     // щипок ещё не взят или его забрал палец — берём свободный
        h = s.h[i] = this._allocHandle();
        h.d.set(0, 0, 0); h.v.set(0, 0, 0); h.e.set(0, 0, 0); h.ev.set(0, 0, 0);
      }
      const at = SPIT_AT[i];
      h.owner = s; h.sig = at[3]; h.c.set(at[0], at[1], at[2]); h.t.set(0, 0, 0); h.goal.set(0, 0, 0);
      h.grabbed = true; h.active = true;
    }
    return true;
  }

  stopSpit() {
    const s = this.spitS;
    s.t = -1; s.fired = false;
    for (const h of s.h) if (h && h.owner === s) h.grabbed = false;     // щёки и губы пружинят обратно
  }

  // где на экране рот (CSS-пиксели окна) — оттуда вылетает плевок
  mouthClient() {
    const r = this.canvas.getBoundingClientRect(), v = this._v[5].set(SPIT_MOUTH[0], SPIT_MOUTH[1], SPIT_MOUTH[2]);
    this.root.localToWorld(v).project(this.camera);
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  }

  _updateSpit(dt) {
    const s = this.spitS;
    let pT = 0, zT = 0, sqT = 0, rT = 0;
    if (s.t >= 0) {
      s.t += dt;
      const [L, R, M] = s.h, own = (h) => h && h.owner === s, amp = s.amp;
      if (!s.fired) {
        // набирает: щёки раздуваются, губы поджаты, голова откидывается и отъезжает назад
        const k = smoothstep(0, s.wind, s.t);
        const wob = s.big ? Math.sin(s.t * 44) * 0.014 * k : 0;                 // долгое «хррр» — щёки дрожат
        if (own(L)) L.t.set((0.16 + wob) * k * amp, -0.01 * k, 0.06 * k);
        if (own(R)) R.t.set(-(0.16 - wob) * k * amp, -0.01 * k, 0.06 * k);
        if (own(M)) M.t.set(0, 0.012 * k, -0.045 * k);
        pT = -0.16 * k * amp; zT = -0.3 * k * amp; sqT = 0.6 * k;
        if (s.t >= s.wind) {
          s.fired = true;
          // воздух вышел: щёки втягиваются, губы — трубочкой вперёд
          if (own(L)) L.t.set(-0.07 * amp, 0, 0.03);
          if (own(R)) R.t.set(0.07 * amp, 0, 0.03);
          if (own(M)) M.t.set(0, -0.015, 0.2 * amp);
          s.jaw = 0.36;
          this.sq.v -= 0.45 * amp;                                               // вся голова пружинит от отдачи
          s.pv += 3.4 * amp; s.zv += 7 * amp;                                    // рывок вперёд
          this._emit('spit', { from: this.mouthClient(), big: s.big });
        }
      } else {
        const u = s.t - s.wind, k = 1 - smoothstep(0.04, 0.3, u);
        // после плевка — довольная рожа: голова набок, глаза щурятся
        const smug = smoothstep(0.35, 0.6, u) * (1 - smoothstep(1.25, 1.7, u));
        pT = 0.1 * k - 0.04 * smug; zT = 0.3 * k; sqT = 0.35 * k + 0.3 * smug; rT = 0.075 * smug * s.side;
        if (u > 0.1) for (const hd of s.h) if (own(hd)) hd.grabbed = false;      // всё отпущено — пружинит обратно
        if (u > 1.75) s.t = -1;
      }
    }
    // наклон и подача головы — на пружине: рывок вперёд и мягкий возврат
    const kS = 170, cS = 2 * 0.5 * Math.sqrt(kS), n = 2, h = dt / n;
    for (let i = 0; i < n; i++) {
      s.pv += ((pT - s.p) * kS - s.pv * cS) * h; s.p += s.pv * h;
      s.zv += ((zT - s.z) * kS - s.zv * cS) * h; s.z += s.zv * h;
      s.rv += ((rT - s.r) * 60 - s.rv * 13) * h; s.r += s.rv * h;
    }
    s.squint += (sqT - s.squint) * damp(dt, 16);
    s.jaw *= Math.exp(-dt * 8);
    this.pivot.position.z = PIVOT.z + s.z;
  }

  // ---------- ввод ----------
  _bind() {
    this.canvas.addEventListener('pointerdown', (e) => this._down(e));
    window.addEventListener('pointermove', (e) => this._move(e), { passive: true });
    window.addEventListener('pointerup', (e) => this._up(e));
    window.addEventListener('pointercancel', (e) => this._up(e));
    document.addEventListener('visibilitychange', () => {
      if (!this.loaded) return;
      if (document.hidden) this.renderer.setAnimationLoop(null); else { this.clock.getDelta(); this._loop(); }
    });
  }

  _ndc(x, y) {
    const r = this.canvas.getBoundingClientRect();
    return this._n2.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  }

  _toHead(worldPoint, out) { return out.copy(worldPoint).applyMatrix4(this._headInv); }

  _down(e) {
    if (!this.loaded || this.intro.on || (e.pointerType === 'mouse' && e.button !== 0)) return;
    this.raycaster.setFromCamera(this._ndc(e.clientX, e.clientY), this.camera);
    const hit = this.raycaster.intersectObjects(this.pickables, false)[0];
    if (!hit) return;
    e.preventDefault();
    const camDir = this.camera.getWorldDirection(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir.clone().negate(), hit.point);
    const glasses = this._isGlasses(hit.object);
    const local = this._toHead(hit.point, new THREE.Vector3());
    const drag = { plane, x0: e.clientX, y0: e.clientY, px: e.clientX, py: e.clientY, t0: performance.now(), moved: 0, glasses, local,
      touch: e.pointerType !== 'mouse', region: glasses ? 'glasses' : this._region(local, hit.object) };
    if (glasses) {
      drag.gl = this.glasses.node.worldToLocal(hit.point.clone());   // за какое место очков взялись
      this._ensureOverlay();
      this.glasses.grabbed = true;
      this.glasses.target.copy(this.glasses.offset);
    } else {
      const h = this._allocHandle();
      h.c.copy(local); h.t.set(0, 0, 0); h.goal.set(0, 0, 0);
      h.d.set(0, 0, 0); h.v.set(0, 0, 0); h.e.set(0, 0, 0); h.ev.set(0, 0, 0);
      h.grabbed = true; h.active = true; h.owner = null; h.sig = 0;
      drag.handle = h;
      const nW = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : camDir.clone().negate();
      drag.normal = nW.transformDirection(this._headInv);
      h.v.copy(drag.normal).multiplyScalar(-0.35);     // лёгкое «продавливание» пальцем в момент захвата
    }
    if (drag.touch) vibrate(6);
    this.drags.set(e.pointerId, drag);
    try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
    this.canvas.style.cursor = 'grabbing';
    this._emit('grab', { region: drag.region });
  }

  _move(e) {
    // Взгляд ведёт только курсор мыши. За пальцем голова не следит: на телефоне она смотрит на посетителя,
    // на папки, когда их листают (это решает страница — lookAtClient), и по наклону телефона.
    if (e.pointerType !== 'touch') {
      this.pointer.x = e.clientX; this.pointer.y = e.clientY; this.pointer.has = true;
      this.pointer.lastMove = performance.now();
    }
    const drag = this.drags.get(e.pointerId);
    if (!drag) { this._hover(e); return; }
    drag.px = e.clientX; drag.py = e.clientY;
    drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0));
  }

  // Цель щипка пересчитывается каждый кадр: голова поворачивается, а точка остаётся под курсором
  _dragTo(drag) {
    this.raycaster.setFromCamera(this._ndc(drag.px, drag.py), this.camera);
    const p = this.raycaster.ray.intersectPlane(drag.plane, this._v[0]);
    if (!p) return;
    if (drag.glasses) {
      // Очки можно унести куда угодно. Точка, за которую их взяли, остаётся под курсором,
      // как бы ни поворачивались голова и сами очки.
      const g = this.glasses, node = g.node;
      node.updateWorldMatrix(true, false);
      const rel = node.localToWorld(this._v[1].copy(drag.gl)).sub(node.getWorldPosition(this._v[6]));
      const want = node.parent.worldToLocal(this._v[7].copy(p).sub(rel));
      g.target.copy(want).sub(g.home);
      if (g.target.length() > 40) g.target.setLength(40);
    } else {
      const local = this._toHead(p, this._v[1]);
      const t = local.sub(drag.handle.c);
      if (t.length() > 3) t.setLength(3);
      drag.handle.t.copy(t);
    }
  }

  _up(e) {
    const drag = this.drags.get(e.pointerId);
    if (!drag) return;
    this.drags.delete(e.pointerId);
    const quick = drag.moved < 6 && performance.now() - drag.t0 < 350;
    if (drag.glasses) {
      const g = this.glasses;
      g.grabbed = false;
      if (g.offset.length() > 0.3) {
        // очки повисают там, где их отпустили (в координатах экрана), потом голова наденет их сама
        g.node.getWorldPosition(g.world);
        g.holdUntil = performance.now() + GLASSES_HOLD; g.selfReturn = true;
        if (!g.announced) { g.announced = true; this._emit('glassesoff', {}); }
      } else if (quick) this._emit('poke', { region: 'glasses' });
    } else {
      const h = drag.handle;
      h.grabbed = false;
      if (quick) {
        h.v.copy(drag.normal).multiplyScalar(-1.25);     // тычок: ямка, которая пружинит обратно
        h.ev.copy(drag.normal).multiplyScalar(-0.5);
        this.boing(0.035);
        if (drag.touch) vibrate(8);
        this._emit('poke', { region: drag.region });
      } else {
        const s = this._v[0].copy(h.d).add(h.e).length();
        this.sq.v -= Math.min(0.9, s * 0.9);             // отпустил — голова «пружинит» целиком
        if (drag.touch && s > 0.2) vibrate(s > 0.6 ? [14, 50, 8] : 10);
        this._emit('release', { region: drag.region, stretch: s });
      }
    }
    this.canvas.style.cursor = 'grab';
  }

  _hover(e) {
    if (!this.loaded || this.intro.on) return;
    if (e.target !== this.canvas) { if (this._hovering) { this._hovering = false; this.canvas.style.cursor = ''; } return; }
    const now = performance.now();
    if (now - (this._lastHover || 0) < 70) return;
    this._lastHover = now;
    this.raycaster.setFromCamera(this._ndc(e.clientX, e.clientY), this.camera);
    this._hovering = this.raycaster.intersectObjects(this.pickables, false).length > 0;
    this.canvas.style.cursor = this._hovering ? 'grab' : '';
  }

  _allocHandle() {
    let best = this.handles.find((h) => !h.active);
    if (!best) {
      const mag = (h) => h.d.lengthSq() + h.e.lengthSq();
      best = this.handles.filter((h) => !h.grabbed).sort((a, b) => mag(a) - mag(b))[0] || this.handles[0];
    }
    return best;
  }

  _region(p, obj) {
    const base = obj?.userData?.base || '';
    if (/^Eye_/.test(base)) return 'eye';
    if (/^Piercing_EarCuff/.test(base)) return 'ear';
    if (/^Piercing_Septum/.test(base)) return 'nose';
    const ax = Math.abs(p.x);
    if (p.y > 0.3 || p.z < -0.05) return 'hair';
    if (ax > 0.6 && p.y > -0.45 && p.y < 0.2) return 'ear';
    if (p.y < -0.74) return 'chin';
    if (p.y < -0.48 && ax < 0.24 && p.z > 0.55) return 'mouth';
    if (p.y < -0.18 && p.y > -0.48 && ax < 0.14 && p.z > 0.7) return 'nose';
    if (p.y > -0.24 && p.y < 0.04 && ax > 0.08 && ax < 0.36 && p.z > 0.45) return 'eye';
    if (p.y >= 0.04 && p.z > 0.35) return 'forehead';
    return 'cheek';
  }

  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  // ---------- кадр ----------
  _loop() { this.renderer.setAnimationLoop(() => this._pace()); }

  // Когда ничего не происходит (голову не трогают, она молчит, курсор и телефон неподвижны), хватает 30 кадров в секунду:
  // моргание и лёгкое покачивание выглядят так же, а устройство греется вдвое меньше.
  _calm(now) {
    if (this.intro.on || this.drags.size || this.lookOverride || this.spitS.t >= 0 || this.glasses.grabbed || this.blind > 0) return false;
    const tilt = this.mode !== 'corner';                 // в углу наклон голову не двигает — и покою не мешает
    if (now - Math.max(this.pointer.lastMove, tilt ? this.tilt.lastMove : 0, this._stir || 0) < 1400 || (tilt && this.tilt.speed > 0.06)) return false;
    if (this.mouthTarget > 0.004 || this.mouth > 0.01 || this.glasses.offset.lengthSq() > 1e-5) return false;
    if (Math.abs(this.sq.v) > 0.02 || Math.abs(1 - this.sq.s) > 0.004 || Math.abs(1 - this.pop.s) > 0.004) return false;
    for (const h of this.handles) if (h.active) return false;
    return true;
  }

  _pace() {
    const now = performance.now(), q = this.q;
    q.calm = this._calm(now);
    if (q.calm && now - (this._drawn || 0) < 29) return;       // спокойный режим: рисуем через кадр
    this._drawn = now;
    this._tick();
  }

  // Подстройка плотности пикселей. Кадры идут реже 40 в секунду — снижаем плотность на шаг и смотрим: стало быстрее —
  // значит, не успевала видеокарта, оставляем; не стало — дело не в ней (режим энергосбережения, слабый процессор):
  // возвращаем как было и больше не трогаем. Кадров с запасом — понемногу возвращаем резкость.
  _adapt(real, now) {
    const q = this.q;
    q.fpsN++;
    if (now - q.fpsT >= 1000) { q.fps = Math.round((q.fpsN * 1000) / (now - q.fpsT)); q.fpsN = 0; q.fpsT = now; }
    if (q.pinned || q.calm || real > 0.25 || document.hidden) return;      // спокойный режим и возвращение на вкладку не считаем
    if (this.intro.on) { q.n = 0; q.hold = now + 1500; return; }            // сборка головы — не показатель
    q.ema += (Math.min(real * 1000, 50) - q.ema) * 0.08; q.n++;              // одиночный долгий кадр (сборка мусора) погоды не делает
    if (now < q.hold || q.n < 45) return;
    q.n = 0;
    if (q.trial) {
      if (q.ema > q.trial.ema * 0.88) { this._setRatio(q.trial.ratio); q.pinned = true; }
      q.trial = null; q.hold = now + 1500;
    } else if (q.upFrom) {
      if (q.ema > 19) { q.max = q.upFrom; this._setRatio(q.upFrom); }       // резкость вернули рано: это потолок для устройства
      q.upFrom = 0; q.hold = now + 1500;
    } else if (q.ema > 25 && q.ratio > q.min + 0.01) {
      q.trial = { ratio: q.ratio, ema: q.ema };
      this._setRatio(Math.max(q.min, q.ratio * 0.8)); q.hold = now + 500;
    } else if (q.ema < 12.5 && q.ratio < q.max - 0.01 && now > q.upAt) {
      q.upFrom = q.ratio; q.upAt = now + 10000;
      this._setRatio(Math.min(q.max, q.ratio * 1.15)); q.hold = now + 500;
    }
  }

  _setRatio(r) {
    this.q.ratio = r; this.q.ema = 16;
    this.renderer.setPixelRatio(r);                      // буфер пересоздан и пуст — кадр дорисуется сразу, мы внутри _tick
  }

  _tick() {
    const real = this.clock.getDelta(), dt = Math.min(real, 1 / 30);
    const now = performance.now();
    this._adapt(real, now);
    if (this.onTick) this.onTick(dt, now);
    this._updatePop(dt);
    this._updateIntro(dt, Math.min(real, 0.12));
    this._updateTilt(dt);
    this._updateSpit(dt);
    this._updateLook(dt, now);
    this._updateBlink(dt);
    this._updateMouth(dt);
    if (this.drags.size) {
      this.root.updateWorldMatrix(true, false);
      this._headInv.copy(this.root.matrixWorld).invert();
      for (const d of this.drags.values()) this._dragTo(d);
    }
    this._updateGlasses(dt, now);
    this._updateHandles(dt);
    if (this._sceneTo) {
      const l = this.lights.rim2;
      this._sceneFrom = true;
      l.color.lerp(this._sceneTo, damp(dt, 3));
      l.intensity += (LOOK.sceneRim - l.intensity) * damp(dt, 3);
      this.skinU.uRimColor.value.lerp(this._sceneTo, damp(dt, 3));
    }
    this._updateMatrices();
    if (this.ov) this._setOverlay(this.glasses.offset.length() > 0.03 || this.blind > 0.004);
    if (this.onFrame) this.onFrame();
    this.renderer.render(this.scene, this.camera);
    if (this.ov && this.ov.on) this._renderOverlay();
  }

  _updateMatrices() {
    this.scene.updateMatrixWorld();
    this._headInv.copy(this.root.matrixWorld).invert();
    for (const o of this.meshes) {
      const u = o.userData.sqU;
      u.uObjToHead.value.multiplyMatrices(this._headInv, o.matrixWorld);
      u.uHeadToObj.value.copy(u.uObjToHead.value).invert();
    }
  }

  _updatePop(dt) {
    const p = this.pop, s = this.sq;
    const steps = 2, h = dt / steps;
    for (let i = 0; i < steps; i++) {
      p.v += ((1 - p.s) * 120 - p.v * (this.rm ? 22 : 11)) * h; p.s += p.v * h;
      s.v += ((1 - s.s) * 150 - s.v * (this.rm ? 25 : 6.5)) * h; s.s += s.v * h;
    }
    const sy = clamp(s.s, 0.7, 1.35), sx = 1 / Math.sqrt(sy);
    const z = this.intro.on ? this.intro.zoom : 1;
    this.pivot.scale.set(p.s * sx * z, p.s * sy * z, p.s * sx * z);
  }

  _lookTarget(out) {
    if (this.intro.on) return out.set(0, 0.05, this.camera.position.z);      // пока собирается — взгляд прямо в экран
    const src = this.lookOverride || (this.pointer.has ? this.pointer : null);
    if (!src) return out.set(0, 0.05, this.camera.position.z);
    this.raycaster.setFromCamera(this._ndc(src.x, src.y), this.camera);
    if (!this.raycaster.ray.intersectPlane(this._plane, out)) out.set(0, 0, 2);
    return out;
  }

  _updateLook(dt, now) {
    const t = this._lookTarget(this._v[2]);
    const idle = !this.intro.on && !this.lookOverride && now - Math.max(this.pointer.lastMove, this.tilt.lastMove) > 2500;
    const tz = Math.max(0.8, t.z);
    let yaw = clamp(Math.atan2(t.x, tz) * 0.65, -0.52, 0.52);
    let pitch = clamp(-Math.atan2(t.y - 0.05, tz) * 0.5, -0.3, 0.28);
    if (idle && !this.rm) { yaw += Math.sin(now * 0.0006) * 0.07; pitch += Math.sin(now * 0.00043) * 0.035; }
    // глаза успевают первыми, голова догоняет чуть позже — как у живого человека
    const k = this.drags.size ? 1.5 : (this.rm ? 3 : 4.5);
    this.rot.yaw += (yaw - this.rot.yaw) * damp(dt, k);
    this.rot.pitch += (pitch - this.rot.pitch) * damp(dt, k);
    // поворот от наклона телефона (эффект присутствия) ложится поверх: он «физический» и не должен запаздывать
    const P = this.tilt;
    this._q.setFromEuler(this._e.set(this.rot.pitch + this.spitS.p + P.pitch, this.rot.yaw + P.yaw, P.roll + this.spitS.r, 'YXZ'));
    const la = this.lean.a, ang = la.length();
    if (ang > 1e-6) this._q.multiply(this._q2.setFromAxisAngle(this._v[4].copy(la).divideScalar(ang), ang));
    this.pivot.quaternion.copy(this._q);
    if (!this.eyes.length) return;
    this.pivot.updateMatrixWorld(true);
    const inv = this._headInv.copy(this.root.matrixWorld).invert();
    if (idle && !this.rm && now > this.sacc.next) {
      this.sacc.x = rand(-0.07, 0.07); this.sacc.y = rand(-0.03, 0.02); this.sacc.next = now + rand(500, 1600);
    } else if (!idle) { this.sacc.x = 0; this.sacc.y = 0; }
    // Оба глаза смотрят в одну далёкую точку на линии «переносица → цель»:
    // взгляд следует за курсором, но зрачки не съезжают к носу, когда курсор рядом с лицом.
    const mid = this._v[4].set(0, 0, 0);
    for (const eye of this.eyes) mid.add(eye.position);
    mid.multiplyScalar(1 / this.eyes.length);
    const far = this._v[3].copy(t).applyMatrix4(inv).sub(mid).normalize().multiplyScalar(EYE_FAR).add(mid);
    for (const eye of this.eyes) {
      const v = this._v[1].copy(far).sub(eye.position);
      // ограничения как у живых глаз: вверх совсем чуть-чуть (иначе радужка уходит под веко и глаза «закатываются»),
      // вниз и в стороны умеренно — остальное добирает поворот головы
      const ey = clamp(Math.atan2(v.x, v.z) + this.sacc.x, -EYE_YAW, EYE_YAW);
      const ep = clamp(Math.atan2(v.y, Math.hypot(v.x, v.z)) + this.sacc.y, -EYE_DOWN, EYE_UP);
      this.gazePitch = ep;
      this._q.setFromEuler(this._e.set(-ep, ey, 0, 'YXZ'));
      eye.quaternion.slerp(this._q, damp(dt, P.w > 0.5 ? 40 : (this.rm ? 10 : 20)));   // при наклоне глаза держат зрителя цепко
    }
  }

  _setMorph(name, v) { for (const [o, i] of this.morphs[name]) o.morphTargetInfluences[i] = v; }

  _updateBlink(dt) {
    const b = this.blink;
    let v = 0;
    if (b.t < 0) { b.next -= dt; if (b.next <= 0) b.t = 0; }
    if (b.t >= 0) {
      b.t += dt;
      const tc = 0.075, to = 0.12;
      v = b.t < tc ? b.t / tc : 1 - (b.t - tc) / to;
      if (b.t >= tc + to) {
        b.t = -1; v = 0;
        if (!b.double && Math.random() < 0.18) { b.double = true; b.next = 0.12; }
        else { b.double = false; b.next = rand(2.2, 5.8); }
      }
    }
    v = clamp(v, 0, 1);
    const sqT = Math.max(this.glasses.off ? 0.38 : 0, this.spitS.squint);
    this.squint += (sqT - this.squint) * damp(dt, sqT > this.squint ? 12 : 6);
    // веки следуют за взглядом вниз — как у живого человека
    const lidDown = 0.35 * smoothstep(0.02, EYE_DOWN, -(this.gazePitch || 0));
    this._setMorph('Blink_L', Math.max(v, this.squint, lidDown));
    this._setMorph('Blink_R', Math.max(v, this.squint, lidDown));
  }

  _updateMouth(dt) {
    const tgt = Math.max(this.mouthTarget, this.spitS.jaw, this.intro.jaw);
    const up = tgt > this.mouth;
    this.mouth += (tgt - this.mouth) * damp(dt, up ? 30 : 16);
    const m = clamp(this.mouth, 0, 1);
    this._setMorph('JawOpen', m);
    this.mouthU.uMouthOpen.value = m;
  }

  _updateGlasses(dt, now) {
    const g = this.glasses;
    if (!g.node) return;
    const parent = g.node.parent;
    const held = !g.grabbed && now < g.holdUntil;
    let target;
    if (g.grabbed) target = g.target;
    else if (held) {
      // висят там, где их отпустили: голова вертится, очки — нет
      parent.updateWorldMatrix(true, false);
      target = parent.worldToLocal(this._v[3].copy(g.world)).sub(g.home);
    } else target = this._v[3].set(0, 0, 0);
    let k, c;
    if (g.grabbed) { k = 320; c = 2 * Math.sqrt(k); }
    else if (held) { k = 120; c = 2 * Math.sqrt(k); }
    else {
      // обратно на нос: издалека — плавно и без проскока сквозь голову, у самого лица — с лёгкой пружинкой
      k = 46;
      const near = 1 - smoothstep(0.25, 1.0, g.offset.length());
      c = 2 * Math.sqrt(k) * (this.rm ? 1 : 1 - 0.56 * near);
    }
    const steps = 3, h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this._a.copy(target).sub(g.offset).multiplyScalar(k).addScaledVector(g.vel, -c);
      g.vel.addScaledVector(this._a, h);
      g.offset.addScaledVector(g.vel, h);
    }
    g.node.position.copy(g.home).add(g.offset);
    if (g.pop !== g.popDone) {                       // сборка при загрузке: очки «выскакивают» из своей середины
      g.popDone = g.pop;
      g.node.scale.copy(g.homeS).multiplyScalar(g.pop);
    }
    if (g.pop !== 1) { g.node.position.copy(g.home).sub(g.cen).multiplyScalar(g.pop).add(g.cen).add(g.offset); g.node.position.z += Math.max(0, 1 - g.pop) * 0.55; }   // …и надеваются спереди
    const dist = g.offset.length();
    // у лица очки сидят как на голове, вдали — разворачиваются «лицом» к зрителю, где бы на экране ни оказались
    const far = smoothstep(0.3, 1.1, dist);
    if (far > 0) {
      const dir = this._v[5].copy(this.camera.position).sub(g.node.getWorldPosition(this._v[4])).normalize();
      this._q2.setFromUnitVectors(this._v[6].set(0, 0, 1), dir);
      parent.getWorldQuaternion(this._q).invert().multiply(this._q2).multiply(g.homeQ);
      this._q2.copy(g.homeQ).slerp(this._q, far);
    } else this._q2.copy(g.homeQ);
    g.node.quaternion.slerp(this._q2, damp(dt, 12));
    if (g.selfReturn && !g.grabbed && now >= g.holdUntil) { g.selfReturn = false; if (dist > 0.3) this._emit('glassesreturn', {}); }
    if (g.grabbed) g.selfReturn = false;
    // «Близорукость»: чем дальше очки от глаз, тем сильнее размыт мир. Туман наплывает и уходит мягко,
    // а не дёргается вслед за пружиной очков.
    const tgt = smoothstep(0.14, 0.75, dist);
    this.blind += (tgt - this.blind) * damp(dt, tgt > this.blind ? 3.2 : 6);
    if (tgt === 0 && this.blind < 0.002) this.blind = 0;
    g.off = dist > 0.22;
    // если отдельного слоя для очков нет (слабое устройство), снятые очки рисуются поверх головы прямо на основном холсте
    const onTop = dist > GLASSES_ON_TOP && !(this.ov && this.ov.on);
    if (onTop !== !!g.onTop) {
      g.onTop = onTop;
      for (const o of this.glassMeshes) { o.material.depthTest = !onTop; if (o.userData.ro === undefined) o.userData.ro = o.renderOrder; o.renderOrder = onTop ? 6 : o.userData.ro; }
    }
    // стянули с носа, ещё не отпустив — голова уже возмущается
    if (g.grabbed && !g.announced && dist > 0.45) { g.announced = true; this._emit('glassesoff', {}); }
    if (!g.grabbed && !g.off && g.announced) { g.announced = false; this._emit('glasseson', {}); }
  }

  // Физика щипков. Каждый щипок — две пружины:
  //  d — узкий слой, держит точку под пальцем (упругий, с лёгкой оттяжкой);
  //  e — широкий желейный слой: догоняет с запаздыванием и дольше колышется после отпускания.
  // Сила натяжения нелинейная (tanh): чем дальше тянешь, тем сильнее резина сопротивляется.
  // Голова целиком наклоняется вслед за щипком (момент силы вокруг шеи) и раскачивается, когда отпускаешь.
  _updateHandles(dt) {
    const steps = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / steps;
    const rm = this.rm;
    const leanT = this.lean.t.set(0, 0, 0);
    for (let i = 0; i < NH; i++) {
      const hd = this.handles[i];
      if (hd.active) {
        if (hd.grabbed) {
          const L = hd.t.length();
          hd.goal.copy(hd.t).multiplyScalar(L > 1e-6 ? (R_MAX * Math.tanh(L / R_MAX)) / L : 0);
        } else hd.goal.set(0, 0, 0);
        let kE, cE, kD, cD;
        if (hd.grabbed) { kE = 40; cE = 2 * 0.42 * Math.sqrt(40); kD = 240; cD = 2 * 0.62 * Math.sqrt(240); }
        else if (rm) { kE = 40; cE = 2 * Math.sqrt(40); kD = 90; cD = 2 * Math.sqrt(90); }
        else { kE = 36; cE = 2 * 0.26 * Math.sqrt(36); kD = 110; cD = 2 * 0.3 * Math.sqrt(110); }
        const eGoal = this._v[6], dGoal = this._v[7];
        for (let s = 0; s < steps; s++) {
          eGoal.copy(hd.goal).multiplyScalar(hd.grabbed ? JELLY : 0);
          this._a.copy(eGoal).sub(hd.e).multiplyScalar(kE).addScaledVector(hd.ev, -cE);
          hd.ev.addScaledVector(this._a, h); hd.e.addScaledVector(hd.ev, h);
          if (hd.grabbed) dGoal.copy(hd.goal).sub(hd.e); else dGoal.set(0, 0, 0);   // вместе слои держат точку под пальцем
          this._a.copy(dGoal).sub(hd.d).multiplyScalar(kD).addScaledVector(hd.v, -cD);
          hd.v.addScaledVector(this._a, h); hd.d.addScaledVector(hd.v, h);
        }
        const cap = R_MAX * 1.3;
        if (hd.d.length() > cap) hd.d.setLength(cap);
        if (hd.e.length() > cap) hd.e.setLength(cap);
        if (hd.grabbed) {
          // момент силы относительно шеи: (точка − шея) × смещение
          const r = this._v[5].copy(hd.c).sub(PIVOT);
          leanT.add(r.cross(this._v[6].copy(hd.d).add(hd.e)));
        }
        if (!hd.grabbed && hd.d.lengthSq() + hd.e.lengthSq() < 1e-6 && hd.v.lengthSq() + hd.ev.lengthSq() < 1e-4) {
          hd.active = false; hd.d.set(0, 0, 0); hd.v.set(0, 0, 0); hd.e.set(0, 0, 0); hd.ev.set(0, 0, 0);
        }
      }
      const LD = hd.d.length(), LE = hd.e.length();
      const sD = Math.max(hd.sig || SIG_MIN, LD / 1.2);
      this.shared.uSqC.value[i].copy(hd.c);
      this.shared.uSqD.value[i].copy(hd.d);
      this.shared.uSqE.value[i].copy(hd.e);
      this.shared.uSqS.value[i] = sD;                                  // шире с растяжением: поле не складывается само в себя
      this.shared.uSqW.value[i] = Math.max(sD * 2.1, LE / 1.2);
      this.shared.uSqA.value[i] = 0.07 * smoothstep(0, 0.5, LD);
    }
    // наклон головы вслед за щипком (пружина с лёгким раскачиванием)
    const ln = this.lean;
    leanT.multiplyScalar(rm ? 0.1 : 0.22);
    if (leanT.length() > 0.3) leanT.setLength(0.3);
    const kL = this.drags.size ? 60 : 48, cL = rm ? 2 * Math.sqrt(kL) : 2 * (this.drags.size ? 0.5 : 0.2) * Math.sqrt(kL);
    for (let s = 0; s < steps; s++) {
      this._a.copy(leanT).sub(ln.a).multiplyScalar(kL).addScaledVector(ln.v, -cL);
      ln.v.addScaledVector(this._a, h); ln.a.addScaledVector(ln.v, h);
    }
  }
}
