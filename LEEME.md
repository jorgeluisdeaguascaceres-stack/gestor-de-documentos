# NEXUSMED · App clínica (prototipo)

App web limpia inspirada en el diseño y colores de tu sistema real NEXUSMED
(azul marino oscuro + cian). La pantalla de inicio tiene **3 tarjetas verticales**:

1. **Admisión** – formulario de ingreso de pacientes + lista de admisiones recientes.
2. **Registro Médico** – lista de historias clínicas / notas de evolución, con buscador,
   filtro por tipo y creación de notas (Historia clínica, Evolución SOAP, Nota de
   enfermería, Terapia, Epicrisis).
3. **Configuraciones** – parámetros de la IPS + gestión de usuarios (crear, activar/
   desactivar, eliminar, con roles Administrador / Médico / Auditor).

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
