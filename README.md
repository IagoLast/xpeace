# xpeace

Una app en español que analiza respuestas y menciones de X, responde **block por nabo 🫜** y bloquea automáticamente los malos modos. Incluye historial de evaluaciones, sesión, suscripción y modo claro/oscuro; la limpieza tiene su propia sección de utilidades. Next.js App Router, TypeScript, Tailwind y componentes shadcn/ui, preparado para Vercel con Neon Postgres.

Instancia: [xpeace.vercel.app](https://xpeace.vercel.app), en el proyecto `iago-lastras-projects/xpeace`. Base de datos Neon `xpeace-db` en Frankfurt, plan Free. El cron está configurado para Hobby, una vez al día.

Repositorio: [IagoLast/xpeace](https://github.com/IagoLast/xpeace). Vercel está conectado a GitHub y despliega automáticamente cada push a `main` en el dominio de producción. Las ramas adicionales generan previews; las credenciales de Stripe live están configuradas solo en producción.

La aplicación de X es `xpeace-iagolast` (ID `33552492`), conectada al proyecto `xpeace`, con OAuth 2.0 confidential client y callbacks `https://xpeace.vercel.app/api/auth/callback`, `http://127.0.0.1:3000/api/auth/callback` y `http://localhost:3000/api/auth/callback`. En esta máquina se usa `127.0.0.1:3000`: otro proyecto ocupa el puerto 3000 en IPv6. X aceptó `https://iagolast.com` como web del desarrollador; rechazó `https://xpeace.vercel.app` en el campo Website URL. Las credenciales de OAuth están en las variables privadas de Vercel y en `.env.local`, excluido de Git. Las claves iniciales de aplicación están guardadas en `.vercel/x-app-keys.json`, también excluido de Git.

Tras añadir saldo el 19 de octubre de 2026, se ha verificado una consulta real a X (`200`) y una evaluación real con `typesafe-ai/jev-1.14.0` a través de AI Gateway. Para uso personal, configura `ALLOWED_X_USER_IDS` con el ID de la cuenta conectada. La aplicación no compra créditos ni activa recargas automáticas.

## Arrancar

Requiere Node.js 22.12+ (desarrollado con Node 24).

```sh
npm install
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Abre [127.0.0.1:3000](http://127.0.0.1:3000) y pulsa **Iniciar sesión con X**. La configuración, la actividad y la limpieza solo aparecen después de autorizar una cuenta.

## Conectar una cuenta real

1. Crea una aplicación **Web App / confidential client** en la [consola de desarrolladores de X](https://developer.x.com/). Activa OAuth 2.0 con permisos de lectura y escritura.
2. Registra exactamente `http://127.0.0.1:3000/api/auth/callback` como callback de desarrollo. En producción usa `https://tu-dominio/api/auth/callback`.
3. Crea una base de datos Neon, por ejemplo mediante Vercel Marketplace. Copia su `DATABASE_URL`.
4. Copia `.env.example` a `.env.local` y completa las variables. Genera `APP_SECRET` y `CRON_SECRET` independientemente con `openssl rand -hex 32`. Nunca los subas al repositorio. Conserva `APP_SECRET`: cambiarlo invalida sesiones e impide descifrar los tokens guardados.
5. Para JEV usa `AI_GATEWAY_API_KEY` o la autenticación OIDC de Vercel. En local, `vercel env pull .env.local` permite usar OIDC cuando el proyecto ya está vinculado; refresca el token cuando caduque. No sobrescribas tus variables locales sin conservarlas.
6. Ejecuta `npm run db:migrate`, reinicia el servidor y entra en **Iniciar sesión con X**.

`APP_URL` debe coincidir exactamente con el origen usado en el navegador, sin barra final. `http://localhost:3000` y `http://127.0.0.1:3000` son orígenes diferentes. En producción debe usar HTTPS.

Para un despliegue personal, configura `ALLOWED_X_USER_IDS` con tu ID de X. Si se deja vacío, cualquier cuenta que complete OAuth puede entrar a su propio espacio. El procesamiento requiere una suscripción pagada y cupo disponible. La identificación inicial con X (`/users/me`) ocurre antes de conocer la cuenta y queda fuera de esos cupos. Cada consulta y acción se limita a la cuenta de la sesión.

## Suscripciones con Stripe

**xpeace Lite: 2,99 USD/mes por cuenta de X**, para uso ligero, con Checkout alojado en Stripe y portal para tarjetas, facturas y cancelaciones. El precio se obtiene de `STRIPE_PRICE_ID` al iniciar Checkout: debe ser un precio activo, mensual, fijo, de importe positivo y cantidad uno. La aplicación no crea cargos por exceso ni vende ampliaciones. El precio y el total se muestran en Stripe antes de confirmar el pago. Si cambias el precio, actualiza también el texto de `BillingPanel`.

Incluye 200 créditos de actividad en X, hasta 100 análisis con JEV y hasta 50 operaciones de limpieza por período pagado. Todo el trabajo en X comparte esos 200 créditos: leer una publicación cuesta 1, consultar un autor 2, publicar la respuesta con URL 40, bloquear 3 y eliminar una publicación o un like 2. Los máximos de análisis y limpieza no son adicionales al saldo de X. Por ejemplo, leer 10 menciones con 10 autores distintos usa 30 créditos; comprobar, responder y bloquear una de ellas añade 44.

La estimación reserva **1 USD por usuario y mes para X**: cada crédito representa 0,005 USD con las [tarifas publicadas de X](https://docs.x.com/x-api/getting-started/pricing), sin depender de descuentos de propietario ni deduplicación. JEV publica [0,04 USD por millón de tokens de entrada](https://vercel.com/ai-gateway/models/jev); su coste varía con la longitud. Para la cuenta española, [Stripe](https://stripe.com/es/pricing) publica 1,5 % + 0,25 EUR con tarjetas estándar del EEE, 0,7 % adicional por Billing y posibles recargos por tarjeta/divisa. Presupuestar aproximadamente 0,40–0,60 USD por cobro deja alrededor de 1,39–1,59 USD antes de JEV, impuestos, alojamiento y soporte. Es una estimación de uso ligero, no una garantía de margen. Vercel Hobby no permite uso comercial: cambiar a un plan apto para vender antes del lanzamiento.

### Configuración de esta instancia

Configurado el 19 de octubre de 2026 en Stripe **live**:

- Producto `prod_VTDY1Yr79YZJzl`, precio mensual USD `price_1USH7bL0gLj4YmgjQJJ8B09n`.
- Portal `bpc_1USH7wL0gLj4YmgjsIV6H8sz`, con baja al final del período y actualización de tarjeta.
- Webhook `we_1USH8JL0gLj4YmgjArPHFkcj`, **habilitado** para `https://xpeace.vercel.app/api/billing/webhook`. La ruta desplegada rechaza peticiones sin firma y acepta un evento de diagnóstico firmado, consultando la base de datos sin modificar suscripciones.
- `mcp.json` conecta con `https://mcp.stripe.com`; está excluido de Git y del paquete de despliegue. Las credenciales están en `.env.local` y en variables de producción de Vercel, nunca en el código cliente. La configuración de `mcp.json` debe cargarla el cliente MCP; durante la preparación se ha verificado la conexión JSON-RPC directamente.

Las migraciones de base de datos están aplicadas, incluida `004-automatic-bpn.sql` el 19 de octubre de 2026. Se verificó que se conservaron las cuentas y el estado de activación de BPN. Se han comprobado Checkout y portal con la API real, sin completar ningún pago; la sesión se ha caducado y el cliente temporal se ha eliminado. La validación de aquella configuración incluyó tests de servidor y navegador, lint, tipos y build. La compra completa en sandbox sigue pendiente de credenciales de prueba.

La versión está publicada y el saldo de X/JEV ha sido comprobado con llamadas reales. Se mantiene Vercel Hobby para las pruebas personales; antes de ofrecer el servicio comercialmente, utiliza alojamiento que permita ese uso. No se ha contratado un plan de alojamiento adicional durante esta configuración. La comprobación firmada del webhook no sustituye una compra completa en sandbox.

### Configuración inicial

1. En el entorno de prueba de Stripe, crea el producto **xpeace** y su precio mensual con el importe y moneda elegidos. Copia su ID `price_...` en `STRIPE_PRICE_ID`.
2. Configura `STRIPE_SECRET_KEY` (`sk_test_...` inicialmente) en `.env.local` o en las variables privadas de Vercel. No hace falta clave publicable: el formulario de pago está alojado en Stripe.
3. Activa el [portal de clientes](https://dashboard.stripe.com/settings/billing/portal): permite actualizar la tarjeta, ver facturas y cancelar **al final del período**. Desactiva cambios de plan/cantidad, porque esta versión ofrece un único plan. Usa la configuración predeterminada o indica su `bpc_...` en `STRIPE_PORTAL_CONFIGURATION_ID`.
4. Crea un destino de eventos **snapshot**, de tu propia cuenta, para `https://xpeace.vercel.app/api/billing/webhook` (o el mismo path en tu `APP_URL`). Usa la versión de API **2026-09-30.endive**, que coincide con Stripe SDK 23. Guarda su secreto `whsec_...` en `STRIPE_WEBHOOK_SECRET`. Selecciona estos eventos:

   ```text
   checkout.session.completed
   checkout.session.async_payment_succeeded
   checkout.session.async_payment_failed
   customer.subscription.created
   customer.subscription.updated
   customer.subscription.deleted
   customer.subscription.paused
   customer.subscription.resumed
   invoice.paid
   invoice.payment_failed
   invoice.payment_action_required
   ```

5. Ejecuta `npm run db:migrate` en la base de datos del entorno correspondiente antes de desplegar. Aplica todas las migraciones idempotentes de `db/`, incluidas `003-x-credits.sql` y `004-automatic-bpn.sql`; conserva las cuentas y el historial existentes. Sin configuración de Stripe, el procesamiento queda bloqueado, incluso para cuentas antiguas.
6. Los valores del plan son `BILLING_X_CREDITS_LIMIT=200`, `BILLING_ANALYSES_LIMIT=100`, `BILLING_CLEANUP_LIMIT=50` y un tope técnico de `BILLING_X_REQUESTS_LIMIT=2000`, que incluye consultas vacías. Los cupos se fijan al activar cada período pagado; cambiarlos no altera el cupo del período en curso. La migración de créditos inicia este contador para períodos antiguos; revisa manualmente su consumo previo si migras una instalación que ya tenga suscripciones.

Para probar webhooks en local:

```sh
stripe listen --forward-to http://127.0.0.1:3000/api/billing/webhook
```

Usa el `whsec_...` que devuelve ese listener en tu entorno local. Compra el plan desde la aplicación con una tarjeta de prueba de Stripe y comprueba alta, renovación, pago fallido y cancelación. **Comprobar pago** reconcilia el estado directamente con Stripe, también al volver de Checkout o del portal. Un parámetro `?billing=success` por sí solo no concede acceso. Los tests locales simulan la frontera HTTP de Stripe; la compra en el sandbox de tu cuenta queda pendiente hasta configurar sus credenciales.

Al pasar a producción, usa las claves, el precio, el portal y el secreto de webhook del entorno real; no mezcles objetos de prueba y producción. Configura los datos comerciales y fiscales que correspondan en Stripe antes de aceptar pagos. El checkout actual utiliza el tratamiento de impuestos definido en tu precio/configuración; no activa Stripe Tax automáticamente.

### Acceso y consumo

- Se exige `active`, factura actual pagada, precio autorizado y período vigente. No se conceden pruebas gratuitas. Un impago pausa el procesamiento; la cancelación programada conserva el acceso durante el período pagado. **Cerrar sesión** invalida la sesión y mantiene BPN y los trabajos en marcha. **Cancelar suscripción** abre directamente el flujo de baja de Stripe para la suscripción de la cuenta autenticada; **Gestionar suscripción** abre tarjetas y facturas.
- Los webhooks verifican la firma sobre el cuerpo original, recuperan el estado actual en Stripe y registran los eventos procesados. Duplicados, eventos desordenados y reintentos no reinician el consumo. Checkout reutiliza sesiones abiertas y usa bloqueo e idempotencia para evitar suscripciones duplicadas desde la aplicación.
- El servidor reserva cupo atómicamente antes de cada petición de X, cada evaluación de JEV y cada eliminación. Reserva el coste máximo de una página, incluyendo autores expandidos, y libera solo los créditos sobrantes de respuestas completas y correctas, contra el período original. Limita las páginas a 20 publicaciones y las reduce según el saldo; X exige al menos 5 publicaciones por petición (15 créditos con autores). Si no alcanza para esa consulta, se pausa aunque quede saldo para otra operación menor. Errores y envíos ambiguos conservan toda la reserva. Al agotarse un cupo se guarda el progreso; el período siguiente obtiene contadores nuevos. No se reinician por reconexión.
- Las comprobaciones cubren acciones del panel, llamadas directas a la API y cron. Leer la actividad, desactivar BPN, cancelar trabajos y abrir el portal no requieren tener una suscripción activa.
- El presupuesto de X depende de sus tarifas vigentes; revisa el coste antes de añadir endpoints o modificar el coste de las operaciones. Las tarifas, los créditos y las alertas de gasto de X y AI Gateway se gestionan por separado de Stripe. Las llamadas iniciales de OAuth/identidad no están incluidas en el cupo por cuenta. La evaluación de JEV varía en longitud y no tiene un presupuesto monetario medido.
- Si reembolsas una suscripción o recibes una disputa, cancela también la suscripción en Stripe cuando quieras retirar el servicio. Un reembolso por sí solo no cancela una suscripción; esta versión sincroniza el ciclo de suscripción y pago, no automatiza decisiones sobre disputas.

El botón de baja utiliza el [flujo directo de cancelación del portal de Stripe](https://docs.stripe.com/customer-management/portal-deep-links).

Referencias: [Checkout para suscripciones](https://docs.stripe.com/payments/checkout/build-subscriptions), [webhooks](https://docs.stripe.com/billing/subscriptions/webhooks) y [portal](https://docs.stripe.com/customer-management).

Scopes solicitados: `tweet.read tweet.write users.read like.read like.write block.read block.write offline.access`. Se usan PKCE S256, comprobación de `state`, cookies HttpOnly/SameSite y cifrado AES-256-GCM para credenciales. El refresh de tokens se serializa con las demás operaciones de la cuenta.

## Limpieza

- En **Utilidades** (`/utilities`), selecciona tweets, likes y/o respuestas. Puedes elegir **Todo el historial** accesible o una fecha límite exclusiva en UTC.
- **Preparar vista previa** recorre las páginas disponibles y guarda una selección persistente. No borra nada durante esta fase.
- Revisa la muestra, el total y confirma escribiendo `BORRAR`.
- El trabajo elimina en lotes de hasta diez elementos. Los likes se retiran de tu cuenta; no se eliminan los posts de otras personas. La fecha de los likes corresponde a la publicación, no al momento de dar me gusta.
- Puedes cancelar. Una petición que ya se está ejecutando puede terminar; los elementos ya eliminados no se restauran.
- Se respetan los límites de X y se guarda el progreso. Los errores individuales se contabilizan. Una nueva vista previa permite volver a intentar esos elementos.

**Límite de alcance:** solo se procesa el historial accesible por los endpoints y el nivel de acceso de tu aplicación en X. La paginación no evita los límites de profundidad/retención de la API. Todavía no hay importación del archivo completo de X. Los reposts se excluyen. Los tweets y respuestas borrados no son recuperables.

## BPN

JEV se invoca usando `experimental_decide` de AI SDK 7, con el modelo verificado `typesafe-ai/jev-1.14.0`, a través de Vercel AI Gateway. Es un modelo de decisiones: devuelve probabilidades de abuso, insulto explícito y petición de baja. No se le pide generar la respuesta; el texto enviado es **`block por nabo 🫜 ${APP_URL}/bpn`**. La página pública `/bpn` explica el proyecto y ofrece un enlace para empezar.

- Recoge menciones y respuestas desde la conexión inicial de la cuenta. No evalúa likes ni reposts sin texto, mensajes privados ni imágenes.
- Por defecto BPN está desactivado. Al activarlo con una suscripción, JEV clasifica tanto respuestas directas como menciones; las que superan el umbral reciben la respuesta y el bloqueo automáticamente. El interruptor guarda inmediatamente.
- **Actividad reciente** muestra las evaluaciones, su resultado y un enlace a la publicación. No hay revisión manual, opciones avanzadas ni probador. Las decisiones pendientes se conservan para continuar cuando haya tiempo o cupo, sin repetir la evaluación. Las interacciones antiguas en estado `review` pasan a esta misma cola automática.
- Umbral interno inicial: 90% de probabilidad de abuso. Debe ajustarse con ejemplos reales de tu cuenta; una probabilidad alta no garantiza una clasificación correcta.
- Las cuentas de confianza quedan excluidas. `STOP`, `no me respondas` y peticiones de baja reconocidas por JEV excluyen persistentemente al autor.
- Máximo de 25 intentos de respuesta por cuenta en 24 horas y uno por autor en ese período; las cuentas ya bloqueadas no reciben nuevas respuestas.
- Cada intento de publicación se registra **antes** de llamar a X. Si se interrumpe o el resultado es incierto, se pide revisar X y **no se reenvía**. Si la respuesta se publicó pero el bloqueo falló, se reintenta solamente el bloqueo.
- Si JEV falla o su salida no es válida, no se responde ni se bloquea. La interacción permanece pendiente.

Antes de operar respuestas automáticas, consulta las [reglas de automatización de X](https://help.x.com/en/rules-and-policies/x-automation): X exige aprobación previa para bots de respuestas con IA, consentimiento del destinatario y una vía sencilla de baja. Explica en tu perfil cómo pedirla. Estos requisitos del proveedor se documentan aquí; el producto no incorpora un flujo de revisión humana.

Los textos enviados a evaluación se comparten con Vercel AI Gateway y TypeSafe AI. La base de datos guarda interacciones, decisiones, selecciones de limpieza y credenciales cifradas. Cerrar sesión conserva las credenciales y el procesamiento en segundo plano. La acción de API `disconnect`, separada de cerrar sesión, borra las credenciales y detiene los trabajos; se conserva el registro de actividad. La autorización del proveedor puede revocarse también desde los ajustes de aplicaciones conectadas en X.

## Desplegar en Vercel

1. Importa el repositorio como proyecto Next.js y conecta Neon mediante Marketplace.
2. Configura las variables de `.env.example` en el entorno correspondiente. Fija `APP_URL` al dominio de producción y registra el callback en X.
3. Habilita AI Gateway y su autenticación OIDC o una API key.
4. Ejecuta `npm run db:migrate` contra la base de datos de ese entorno antes de conectar cuentas. El build no ejecuta migraciones ni necesita credenciales.
5. Despliega. `vercel.json` programa `/api/cron` una vez al día, a partir de las 08:00 UTC, compatible con el plan Hobby; el endpoint exige `Authorization: Bearer <CRON_SECRET>`. También puedes sincronizar y procesar desde el panel.

Para ejecutarlo cada cinco minutos, cambia el horario a `*/5 * * * *` en un equipo Pro o usa un planificador externo autenticado. Hobby permite cron diario y no garantiza el minuto exacto de ejecución. Comprueba los [límites actuales de Cron](https://vercel.com/docs/cron-jobs/usage-and-pricing).

El worker procesa una cuenta por invocación, priorizando la menos recientemente atendida. Es una primera versión orientada a uso personal; varias cuentas alargan la cadencia. Las funciones tienen un límite de 60 segundos y las tareas guardan su avance entre invocaciones. Con la limpieza abierta en el navegador, el panel impulsa otro lote cada ocho segundos; en segundo plano continúa el cron. La frecuencia también depende de los límites y del saldo de X.

Los proveedores X, Neon y AI Gateway pueden tener costes y requisitos de acceso independientes de Vercel. No se presupone una cuota gratuita específica.

## Comprobaciones

```sh
npm run typecheck
npm run lint
npm test
npm run build
# Una vez, si no tienes Chromium para Playwright:
npx playwright install chromium
npm run test:e2e
```

Los tests de servidor usan PostgreSQL embebido (PGlite), las consultas SQL de producción, el adaptador real de X con HTTP simulado y el modelo de prueba oficial de AI SDK. Cubren paginación, aislamiento por cuenta, confirmación, cancelación, límites, opt-outs, reanudación y publicaciones ambiguas. Playwright comprueba la pantalla de conexión, el diseño móvil y el rechazo de peticiones sin sesión. **No sustituyen una prueba con una cuenta real y credenciales propias.**

La facturación se prueba con el SDK real de Stripe y HTTP simulado: firmas, identidad del cliente, altas, impagos, cancelaciones, renovación de cupos, concurrencia, reintentos y bloqueo de consumo. Playwright compila y arranca esta versión en `127.0.0.1:3100`, sin reutilizar tu servidor de desarrollo. El panel de cuenta y la pantalla de facturación se montan con sus componentes y estilos reales y respuestas HTTP simuladas, para no conectar las pruebas de navegador a una cuenta o base de datos real.

## Estructura

- `src/components/`: panel y componentes shadcn/ui.
- `src/lib/server/`: OAuth, X, JEV, persistencia y trabajos.
- `src/app/api/`: conexión, acciones autenticadas, estado y cron.
- `db/001-initial.sql`: esquema idempotente inicial.
- `tests/`: pruebas de dominio, integración SQL y navegador.

Referencias: [JEV y modelos System One](https://typesafe.ai/blog/introducing-system-one-models-and-jev), [JEV en AI Gateway](https://vercel.com/ai-gateway/models/jev), [OAuth 2.0 de X](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code).
