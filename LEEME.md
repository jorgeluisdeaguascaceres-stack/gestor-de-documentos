# Sistema de Gestión Documental y Nomenclatura Automatizada

Aplicación web para auditoría médica: crea carpetas de lote y renombra automáticamente
los PDF de los 6 tipos de documento según la fórmula oficial.

**Fórmula de nombre:** `SIGLA` + separador + `NIT` + separador + `NOMBRE_CARPETA` + `.pdf`

El nombre original del archivo se ignora por completo.

Ejemplo con separador `_`, NIT 900123456 y carpeta “Lote_Enero_01”:

```
CRC_900123456_Lote_Enero_01.pdf
AUT_900123456_Lote_Enero_01.pdf
HEV_900123456_Lote_Enero_01.pdf
FEV_900123456_Lote_Enero_01.pdf
OPF_900123456_Lote_Enero_01.pdf
EPI_900123456_Lote_Enero_01.pdf
```

Siglas admitidas: **CRC** (cuenta de cobro), **AUT** (autorizaciones), **HEV** (historia
clínica / hoja de evolución), **FEV** (factura electrónica de venta), **OPF** (orden o
prescripción / fórmula) y **EPI** (epicrisis).

---

## 1. Uso rápido (sin instalar nada)

Abre `index.html` con doble clic en Chrome o Edge. La primera pantalla que verás es
la de **acceso**: crea tu usuario y contraseña (ver sección 2) y a partir de ahí la
aplicación funciona completa en tu equipo, sin internet y sin servidor.

### Pantalla “Crear y procesar”

1. Pulsa **Elegir carpeta de destino** y selecciona en tu equipo la carpeta donde
   quieres guardar (por ejemplo `C:\Users\JORGE\Documents\PROYECT`). El sistema
   creará dentro de esa carpeta únicamente la carpeta del lote: no añade ninguna
   carpeta intermedia ni inventa nombres. Si prefieres, puedes escribir la ruta a
   mano en el campo **Carpeta de destino**; en ese caso los PDF renombrados se
   descargan y tú los colocas ahí.
   (El guardado automático en disco funciona en Chrome y Edge de escritorio; por
   seguridad el navegador solo muestra el nombre de la carpeta elegida, no su ruta
   completa.)
2. Escribe el **nombre de la carpeta** del lote y el **NIT** (solo números, 5 a 15
   dígitos).
3. Elige el **separador**: guión bajo `_`, guión medio `-` o espacio.
4. Pulsa **Crear carpeta**. Debajo verás la vista previa de los 6 nombres finales.
5. Arrastra cada PDF a su caja correspondiente (o haz clic en la caja para
   seleccionarlo). Solo se aceptan archivos PDF. **Puedes soltar varios PDF en la
   misma caja**: se acumulan en una lista numerada donde puedes subirlos, bajarlos o
   quitarlos uno a uno.
6. Pulsa **Procesar** en una caja para renombrar ese documento, o **Procesar todos**
   para hacerlo en lote. Si la caja tiene varios PDF, al procesar se **unen en un
   solo archivo** con el nombre oficial, respetando el orden de la lista.

### Pantalla “Carpetas y descargas”

- Busca por nombre de carpeta o por NIT.
- La tabla muestra fecha y hora de creación, carpeta, NIT y el estado de las 6 siglas
  (verde = cargada, gris = pendiente).
- Descarga el lote completo en **ZIP** o cada documento por separado.
- **Vista previa:** el botón 👁 abre el PDF dentro de la aplicación para revisarlo y,
  desde ahí, **imprimirlo** sin salir de la pantalla.
- **Eliminar:** el botón 🗑 borra un lote (carpeta y sus PDF generados). Pide
  confirmación escrita porque no se puede deshacer.
- **Selección múltiple:** marca la casilla de cada fila (o **Todos**) y descarga
  todos los lotes elegidos en **un solo ZIP**, con una subcarpeta por lote.

Los archivos originales nunca se modifican ni se borran: siempre se genera una copia
renombrada.

### Las cuatro funciones añadidas, en resumen

| Función | Dónde | Qué hace |
|---------|-------|----------|
| Varios PDF en una casilla | Crear y procesar | Une los PDF de la casilla en un único archivo con el nombre oficial |
| Eliminar | Carpetas y descargas | Borra la carpeta/lote y sus documentos, con confirmación |
| Vista previa e impresión | Carpetas y descargas | Revisa el PDF en pantalla y lo envía a la impresora |
| Descarga múltiple | Carpetas y descargas | Varios lotes marcados → un solo ZIP organizado por carpetas |

---

## 2. Acceso con usuario y contraseña

Nadie puede ver lotes, subir PDF ni descargar nada sin identificarse. La pantalla de
acceso se muestra antes de cargar la aplicación y no se puede saltar.

### Primer uso en un equipo (doble clic, sin servidor)

1. Al abrir `index.html` aparece **Crear acceso**.
2. Escribe un nombre de usuario y una contraseña de **8 caracteres o más, con letras
   y números**. El medidor te indica si es débil, aceptable o fuerte.
3. Repite la contraseña y pulsa **Crear acceso**. Entrarás de inmediato.
4. Desde entonces, cada vez que abras la aplicación se pedirá esa contraseña.

La contraseña **no se guarda en ningún sitio**: solo se conserva su huella cifrada
(PBKDF2 con 150 000 repeticiones y sal aleatoria, calculada por el propio navegador).
Aunque alguien lea los datos guardados, no puede deducir la clave.

### Dentro de la aplicación

Arriba a la derecha verás tu usuario y dos botones:

| Botón | Qué hace |
|-------|----------|
| **Cambiar contraseña** | Pide la clave actual y la nueva (dos veces) |
| **Salir** | Cierra la sesión y vuelve a la pantalla de acceso |

La sesión se cierra sola tras un rato de inactividad y al cerrar el navegador.

> **Aviso honesto:** en modo doble clic (sin servidor) el bloqueo es **disuasorio**.
> Evita que alguien abra la aplicación y curiosee, pero **no cifra los PDF** de tu
> disco ni sustituye a un servidor con usuarios reales. Si manejas historias clínicas
> de varios pacientes en un equipo compartido, usa el servidor de la sección 3 y cifra
> el disco con BitLocker.

### Si olvidas la contraseña (modo local)

No hay recuperación posible, precisamente porque la clave no se almacena. Puedes
restablecer el acceso borrando los datos del sitio en el navegador (Configuración →
Privacidad → Datos de sitios). **Tus PDF ya guardados en la carpeta de destino no se
tocan:** solo tendrás que crear el acceso de nuevo.

---

## 3. Uso compartido en red (recomendado para varias personas)

Si varias personas deben ver los mismos lotes, arranca el servidor incluido. Solo
necesitas Node.js 16 o superior; no hay dependencias que instalar.

**Paso 1 — crea el primer administrador:**

```bash
node server.js nuevo-usuario admin TuClaveFuerte1 admin
```

**Paso 2 — arranca el servidor:**

```bash
node server.js
```

Abre `http://localhost:8080`, cambia el modo de almacenamiento a **Servidor** e inicia
sesión con ese usuario. Los demás equipos entran con la IP del servidor
(`http://192.168.x.x:8080`) y sus propias credenciales.

### Roles

| Rol        | Puede |
|------------|-------|
| `admin`    | Todo, y además crear, activar, desactivar y borrar usuarios |
| `auditor`  | Trabajar con lotes y documentos; solo cambia su propia clave |

### Administrar usuarios desde la consola

```bash
node server.js usuarios                              # lista con rol, estado y último acceso
node server.js nuevo-usuario maria Clave2024 auditor # crear (rol por defecto: auditor)
node server.js clave maria NuevaClave2024            # restablecer contraseña
node server.js desactivar maria                      # bloquear sin borrar el historial
node server.js activar maria
node server.js borrar-usuario maria
```

Al restablecer o desactivar una cuenta, sus sesiones abiertas se cierran al instante.

### Protecciones activas en el servidor

- Las contraseñas se guardan como huella PBKDF2 con sal individual, nunca en claro.
- Tras **5 intentos fallidos** el usuario queda **bloqueado 5 minutos** desde esa
  dirección; el servidor responde con un aviso de “demasiados intentos”.
- Toda petición sin sesión válida recibe un rechazo (`401`) y la aplicación te devuelve
  a la pantalla de acceso.
- Se registran entradas, salidas, fallos, bloqueos, cambios de clave y creación de
  usuarios en una bitácora con fecha, usuario e IP.
- Los datos de acceso se guardan solo para el sistema (permisos `600`), dentro de la
  carpeta de datos del servidor:

| Archivo               | Contenido                                    |
|-----------------------|----------------------------------------------|
| `data/usuarios.json`  | Usuarios, roles y huellas de contraseña      |
| `data/bitacora.log`   | Registro de accesos y acciones sensibles     |

Variables disponibles:

| Variable        | Para qué sirve                                   | Valor por defecto |
|-----------------|--------------------------------------------------|-------------------|
| `PORT`          | Puerto de escucha                                 | `8080`            |
| `DATA_DIR`      | Carpeta donde se guardan lotes, usuarios y bitácora | `./data`       |
| `SESION_HORAS`  | Horas de inactividad antes de cerrar la sesión    | `8`               |
| `APP_USER`      | Usuario administrador a crear en el primer arranque | `admin`         |
| `APP_PASSWORD`  | Su contraseña (solo se usa si no hay usuarios)     | *(vacía)*        |

> **Advertencia:** si arrancas el servidor sin ningún usuario creado queda **sin
> autenticación** y lo avisa por consola: cualquiera en la red podría leer y descargar
> los documentos. Crea siempre el administrador antes de compartirlo, mantén el
> servicio dentro de la red interna y, si sale a internet, ponlo detrás de HTTPS con un
> proxy inverso (las cookies de sesión viajan sin cifrar en HTTP).

---

## 4. Archivos incluidos

| Archivo      | Contenido                                                   |
|--------------|-------------------------------------------------------------|
| `index.html` | Interfaz de las dos pantallas                               |
| `app.js`     | Acceso con usuario y contraseña, nomenclatura, cargas, ZIP, vista previa e histórico |
| `pdfmerge.js`| Unión de varios PDF en uno solo, dentro del navegador        |
| `server.js`  | Servidor central opcional con usuarios, sesiones y bitácora (Node.js, sin dependencias) |
| `LEEME.md`   | Este documento                                              |
