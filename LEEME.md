# NEXUSMED · App clínica (prototipo)

App web limpia inspirada en el diseño y colores de tu sistema real NEXUSMED
(azul marino oscuro + cian). La pantalla de inicio tiene **3 tarjetas verticales**:

1. **Admisión** – formulario de ingreso de pacientes + lista de admisiones recientes.
2. **Registro Médico** – lista de historias clínicas / notas de evolución, con buscador,
   filtro por tipo y creación de notas (Historia clínica, Evolución SOAP, Nota de
   enfermería, Terapia, Epicrisis).
3. **Configuraciones** – parámetros de la IPS + gestión de usuarios (crear, activar/
   desactivar, eliminar, con roles Maestro / Administrador / Médico / Auxiliar de
   enfermería / Administrativo) + dos matrices de permisos + **Gestión de EPS** y
   **Seguridad** (cambiar contraseña).

## Permisos: ver vs. crear (Config → Matriz de permisos)
Hay dos tablas:
- **Matriz de permisos**: acceso a cada módulo (Admisión, Registro, Consulta,
  Config) más Editar admisiones y Eliminar notas.
- **Permiso para crear notas**: por cada persona se activa qué tipos de nota puede
  **crear y editar** (Historia clínica, Enfermería, Psicología, Terapia física,
  Fonoaudiología, Terapia ocupacional, Nota de cama, Traqueotomía).

Regla clave: **ver una nota siempre está permitido** a quien tenga acceso al
módulo Registro. Lo que se controla es la **creación/edición**. Así:
- Un **médico** puede leer una nota de enfermería, pero no redactarla.
- Una **auxiliar** puede leer una historia clínica o una terapia, pero no crearlas;
  sí crea sus notas de enfermería, cama y traqueotomía.
Cuando alguien abre una nota que no puede editar, el formulario se muestra en
**solo lectura** (campos bloqueados, sin botón Guardar) y el botón de la lista
aparece como **Ver** en vez de Editar. El botón **+ Nueva nota** se desactiva si
el perfil no tiene permiso para ese tipo. El maestro define todo esto por persona;
por defecto el médico crea todo menos las notas de enfermería, y la auxiliar solo
crea las de enfermería/cama/traqueotomía.

## Historia clínica para la EPS (Registro Médico → Historia clínica)
Al crear una **Historia clínica**, el formulario se abre con los apartados del
formato estándar: Motivo de consulta, Enfermedad actual, Signos vitales (con
IMC calculado automáticamente), Antecedentes, Examen físico, Diagnóstico, Plan
y Paraclínicos. Los datos del paciente (sexo, fecha de nacimiento, dirección,
teléfono, EPS) se toman de su **Admisión**.

Desde la lista de notas, el botón **PDF EPS** genera la historia clínica en
PDF con el formato institucional (encabezado de la IPS, recuadro del paciente,
secciones y firma del profesional), lista para enviar a la EPS.

### Examen físico con autollenado "Normal"
Cada apartado del examen físico tiene un botón **Normal** que escribe el
hallazgo normal estándar (p. ej. en Abdomen pone “Abdomen blando, depresible,
no doloroso...”). El botón **Marcar todo normal** rellena de una sola vez los
apartados que aún estén vacíos. El médico solo cambia lo que encuentre anormal.

### Documentos aparte: Paraclínicos, Orden médica y Fórmula médica
Estos tres apartados se escriben dentro de la historia clínica pero se
**descargan como PDF independientes**: uno por Paraclínicos (si se solicitan),
otro por Orden médica y otro por Fórmula médica. Cada uno sale con el mismo
encabezado de la IPS, los datos del paciente y la firma. La historia clínica
queda limpia (sin esos tres apartados en su cuerpo).

### Vista previa (botón “Ver”)
El botón **Ver** abre una vista previa de todos los documentos antes de
imprimir. Desde ahí puede descargar la historia clínica, cada documento
aparte por separado, o **Descargar todo** de una vez.

## Consulta y exportación (módulo Consulta clínica)
Se busca por **número de documento** del paciente y se puede acotar por
**Servicio** (tipo de nota), **Médico / profesional** y rango de fechas. Los
filtros ahora son más compactos y en pantalla de computador caben en **una sola
línea**. Las fechas se eligen con un **calendario emergente**: toca el campo,
seleccionas el día y pulsas **Aceptar** para confirmar (o **Borrar** para
dejarlo vacío). El
filtro de profesional se llena solo con los nombres que ya figuran en las notas
(los profesionales que se vayan creando y registrando notas), así que puede
**descargar en PDF la historia de un solo profesional**. El profesional elegido
queda escrito en el encabezado del PDF.

El **Reporte de servicios clínicos** que se descarga desde este módulo ahora
sale con el **mismo formato formal que la historia clínica**: encabezado de la
IPS (con logo si se cargó), recuadro con los datos del paciente tomados de la
**Admisión** (documento, sexo, fecha de nacimiento, dirección, teléfono, EPS,
régimen) y, debajo, cada registro clínico en secciones.

## Logo de la IPS (Config → Parámetros de la IPS)
En el registro de la IPS puede **cargar un logo** (PNG o JPEG). Se guarda junto
con el nombre, el NIT y el código de habilitación y aparece en el **encabezado
de todos los PDF** (historia clínica, documentos aparte y reporte de servicios).
Los documentos ya **no llevan ninguna marca del software**: muestran únicamente
los datos de su IPS.

## Gestión de EPS (Config → Gestión de EPS)
Aquí registras las **EPS / entidades** a las que la IPS presta el servicio,
tomando como referencia el listado real del sistema. De cada EPS se guarda:
**Código**, **Nombre** (obligatorio), **URL de verificación de derechos**,
**Régimen** (Contributivo / Subsidiado / Especial / Particular), **NIT**,
**Teléfono**, **Email** y **Observaciones**, además de un interruptor
**Activo**. La tabla permite **editar**, **eliminar** y activar/desactivar cada
entidad. Las EPS activas alimentan automáticamente la lista de EPS del
formulario de **Admisión** (campo con sugerencias).

## Seguridad: cambiar contraseña (Config → Seguridad)
Cada usuario puede **cambiar su propia contraseña** desde esta sección: escribe
la **contraseña actual**, la **nueva** (mínimo 8 caracteres con letras y
números) y su confirmación. La clave se guarda cifrada (PBKDF2) en el navegador.

> Recuerda: al ser una app **solo-navegador** (sin servidor), estas contraseñas
> y permisos NO constituyen seguridad real ni cumplen la **Ley 1581 de 2012**
> para datos reales de pacientes. Para producción hace falta un backend.

## Respaldo y traslado entre equipos (Config → Respaldo)
Como la información se guarda en cada dispositivo, usa la pestaña **Respaldo**:
- **Exportar respaldo**: descarga un archivo `.json` con usuarios, admisiones,
  registros médicos, EPS y parámetros de la IPS.
- **Importar respaldo**: en el otro PC o celular, carga ese `.json` y los datos
  quedan disponibles allí.

> Es un **traslado manual** (tú envías el archivo por correo, WhatsApp o USB).
> NO es sincronización automática en la nube: si quieres que los documentos
> aparezcan solos en todos los dispositivos (como el “1 GB gratis”), hay que
> conectar un servidor real (p. ej. Supabase/Firebase).

## Cómo usarla
Abre `index.html` con doble clic en Chrome o Edge. Todo funciona sin internet.
Los datos se guardan localmente en el navegador (localStorage) — es un prototipo
para seguir diseñando cada módulo poco a poco.

## Archivos
- `index.html` – estructura (inicio + 3 módulos).
- `styles.css` – estilo NEXUSMED (tema oscuro, tarjetas, tablas, modal).
- `app.js` – lógica de los tres módulos.

> Nota: al ser prototipo local, el almacenamiento es de prueba. Para manejar datos
> reales de pacientes se debe integrar con tu backend y cumplir la normativa de
> protección de datos (Colombia: Ley 1581 de 2012 e historia clínica).
