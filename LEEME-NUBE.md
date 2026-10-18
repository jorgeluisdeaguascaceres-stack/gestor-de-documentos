# NEXUSMED · Cómo conectar la app a la nube (Supabase)

Esta guía le permite que **los datos de la clínica se vean desde cualquier
móvil o computador con internet**, y que cada profesional entre con su
**correo y contraseña real**.

> La app sigue funcionando **sin internet** (modo local) si usted no
> configura la nube. La nube es opcional y se activa cuando usted quiera.

---

## Resumen en 3 pasos

1. Crear un proyecto gratis en Supabase.
2. Pegar y ejecutar **una vez** el script `supabase-setup.sql`.
3. Abrir la app, tocar “☁ Conectar a la nube” y pegar 2 datos.

Tiempo aproximado: 10 minutos. No necesita saber programar.

---

## Paso 1 · Crear el proyecto en Supabase

1. Entre a **https://supabase.com** y cree una cuenta (es gratis).
2. Toque **New project** (Nuevo proyecto).
3. Elija un nombre (por ejemplo `nexusmed`), ponga una **contraseña de
   base de datos** (guárdela, pero **no** la necesitará en la app) y la
   región más cercana (por ejemplo *South America (São Paulo)*).
4. Espere 1–2 minutos a que el proyecto quede “listo”.

---

## Paso 2 · Crear la tabla (ejecutar el script SQL)

1. En el menú izquierdo abra **SQL Editor**.
2. Toque **New query**.
3. Abra el archivo **`supabase-setup.sql`** (viene en este mismo paquete),
   copie **todo** su contenido y péguelo en el editor.
4. Toque **Run** (Ejecutar). Debe decir *Success*.

Esto crea una sola tabla llamada `app_state` donde se guardan admisiones,
notas, EPS, datos de la IPS y los perfiles. Queda protegida: **solo las
personas con sesión iniciada** pueden ver o cambiar los datos.

---

## Paso 3 · Copiar los 2 datos de conexión

1. En el menú izquierdo abra **Project Settings** (el engranaje) → **API**.
2. Copie estos **dos** valores:
   - **Project URL** — algo como `https://abcd1234.supabase.co`
   - **anon public** — una clave larga que empieza por `eyJ...`

> ⚠️ Use **solo** estos dos. **Nunca** comparta ni pegue la clave
> `service_role` ni la contraseña de la base de datos: esas dan control
> total. La `anon public` es segura para la app porque la tabla está
> protegida (solo usuarios con sesión acceden).

---

## Paso 4 · Activar la nube en la app

1. Abra la app (`index.html`).
2. En la pantalla de inicio toque **“☁ Conectar a la nube”**.
3. Pegue el **Project URL** y la clave **anon public**.
4. Toque **Probar** (debe decir “✓ Conexión correcta”) y luego
   **Guardar y conectar**.
5. Toque **“¿No tiene cuenta? Crear una”** y registre **solo al maestro**:
   - El **primer** correo que se registre será el **usuario maestro**
     (el único con acceso a *Configuraciones*). Normalmente es usted,
     el administrador de la clínica.

Listo: el maestro ya puede entrar desde cualquier dispositivo.

---

## Paso 5 · El maestro crea el acceso de cada profesional

Una vez el maestro tiene sesión, **él mismo crea el acceso de cada médico**
desde su oficina (no hace falta que el médico esté presente):

1. El maestro entra y abre **Configuraciones → Registro de usuario**.
2. Escribe el **correo** del profesional y una **contraseña temporal**
   (mínimo 6 caracteres), su nombre, rol (médico/enfermería…),
   especialidad, registro y firma si lo desea.
3. Toca **Guardar**. La app crea la credencial en la nube **sin cerrar la
   sesión del maestro** y guarda el perfil (se sincroniza a todos).
4. El maestro le **entrega al profesional ese correo y la contraseña
   temporal** (por WhatsApp, en persona, etc.).

El profesional, desde **cualquier lugar** (otro móvil/ciudad): abre la app,
“Conectar a la nube”, pega los mismos 2 datos **una vez**, y en la pantalla
de inicio **inicia sesión** con el correo y la contraseña que le dieron
(**no** usa “Crear cuenta”). Verá los mismos datos y los cambios aparecen
**en vivo**.

> **Importante:** para que el médico pueda entrar de inmediato con la
> contraseña temporal, en Supabase debe estar **desactivado** “Confirm
> email” (ver *Preguntas frecuentes*). Si está activado, el médico tendría
> que confirmar el correo antes del primer ingreso.
>
> Si un profesional ya **no** debe entrar, el maestro lo **desactiva**
> en *Configuraciones → Registro de usuario*: aunque conozca su
> contraseña, el ingreso quedará bloqueado.

---

## Preguntas frecuentes

**¿Cuánto cuesta?**
El plan gratuito de Supabase incluye ~500 MB de base de datos y ~1 GB de
archivos. Suele bastar para empezar. Ojo: si el proyecto **no se usa por
~1 semana**, se puede *pausar* (se reactiva entrando al panel). El plan
Pro cuesta alrededor de **USD 25/mes** y evita la pausa.

**¿Confirmación por correo?**
Por defecto Supabase puede pedir confirmar el correo al registrarse. Si al
crear la cuenta la app dice “revise su correo”, abra el enlace que llega y
luego inicie sesión. Si prefiere **sin** confirmación (más simple para la
clínica): en Supabase → **Authentication → Providers → Email**, desactive
**“Confirm email”**.

**¿Los datos siguen en el móvil si se va el internet?**
Sí. La app guarda también una copia local; cuando vuelve el internet, los
cambios se sincronizan.

**¿Qué pasa con la Ley 1581 (datos personales)?**
Ahora los datos ya **no** viven solo en el navegador: hay una base de datos
real con control de acceso (sesión obligatoria) y cifrado en tránsito. Para
un uso clínico formal conviene además: definir responsable del tratamiento,
aviso de privacidad y autorización de los pacientes, y revisar la región
donde se alojan los datos. Esta app resuelve la parte técnica base; el
cumplimiento legal completo depende de las políticas de la IPS.

**¿Cómo vuelvo al modo local?**
En la pantalla de inicio de la nube, toque **“Usar sin internet (local)”**.

---

## Solución de problemas

- *“falta crear la tabla” al Probar* → no se ejecutó el Paso 2. Vuelva al
  **SQL Editor** y ejecute `supabase-setup.sql`.
- *“Correo o contraseña incorrectos”* → revise el correo; si acaba de
  registrarse, confirme el correo (ver arriba).
- *No aparecen cambios de otro móvil* → confirme que ambos pegaron el
  **mismo** Project URL y la misma clave anon, y que tienen internet.
