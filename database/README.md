# Base de datos de Aprende LSP

El proyecto guarda solamente la información que no puede derivarse de otra fuente.

| Tabla | Propósito | Información principal |
| --- | --- | --- |
| `auth.users` | Cuenta y autorización administradas por Supabase Auth. | Correo, credenciales, `user_metadata` para el nombre visible y `app_metadata.role` para `student`, `teacher` o `admin`. |
| `public.practices` | Prácticas creadas por docentes. | Título, descripción, video, referencia MediaPipe preparada, dificultad, duración y estado de publicación. |
| `public.practice_attempts` | Historial de intentos de estudiantes. | Estudiante, práctica, puntuación, resultado de la comparación, duración y fecha. |

No se guardan tablas separadas para progreso, favoritos, perfiles ni roles. El progreso se calcula desde `practice_attempts`; el perfil y el rol del proyecto LSP viven en Supabase Auth.

## Plantilla opcional de perfiles

El editor incluye una plantilla **Perfiles** para otros proyectos que sí necesiten información pública o editable más allá de Supabase Auth. La plantilla crea una fila por usuario con:

| Campo | Tipo | Uso |
| --- | --- | --- |
| `user_id` | UUID | Propietario de la fila; el editor lo añade automáticamente. |
| `display_name` | Texto | Nombre que se muestra en la aplicación. |
| `avatar_url` | Imagen | Foto o avatar opcional. |
| `bio` | Texto largo | Descripción breve opcional. |

Esta plantilla no se añade automáticamente a Aprende LSP y no debe almacenar roles de autorización.
