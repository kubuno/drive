use axum::{
    extract::DefaultBodyLimit,
    middleware,
    routing::{delete, get, patch, post, put},
    Router,
};
use tower_http::{
    cors::CorsLayer,
    trace::TraceLayer,
};

use crate::{
    handlers::{activity, archive, files, folders, health, import_url, ipc, public, remotes, scan, search, shares, sync, system, transform, uploads, versions, webdav},
    middleware::{require_auth, require_ipc_secret},
    state::AppState,
};

pub fn build(state: AppState) -> Router {
    // Routes authentifiées
    let authed = Router::new()
        // Dossiers
        .route("/folders",                      get(folders::list).post(folders::create))
        .route("/folders-by-size",              get(folders::list_by_size))
        .route("/folders/:id",                  get(folders::get).delete(folders::delete))
        .route("/folders/:id/rename",           patch(folders::rename))
        .route("/folders/:id/move",             patch(folders::move_folder))
        .route("/folders/:id/star",             post(folders::star))
        .route("/folders/:id/color",            patch(folders::set_color))
        .route("/folders/:id/trash",            post(folders::trash))
        .route("/folders/:id/restore",          post(folders::restore))
        .route("/trash/purge",                  post(folders::purge_trash))
        .route("/folders/:id/versioning",       patch(versions::set_folder_versioning))
        .route("/folders/:id/activity",         get(activity::folder_activity))
        .route("/folders/:id/info-extra",       get(activity::folder_info_extra))
        // Recherche (plein-texte + sémantique optionnel)
        .route("/search",                       get(search::search_files))
        .route("/search/similar",               post(search::search_similar))
        .route("/search/reindex",               post(search::reindex))
        // Fichiers
        .route("/",                             get(files::list))
        .route("/import-url",                   post(import_url::import_from_url))
        .route("/upload",                       post(files::upload)
                                                    .layer(DefaultBodyLimit::max(state.settings.files.max_upload_bytes as usize)))
        .route("/:id",                          get(files::get).delete(files::delete))
        .route("/:id/download",                 get(files::download))
        .route("/:id/thumbnail",                get(files::thumbnail))
        .route("/:id/rename",                   patch(files::rename))
        .route("/:id/move",                     patch(files::move_file))
        .route("/:id/trash",                    post(files::trash))
        .route("/:id/restore",                  post(files::restore))
        .route("/:id/star",                     post(files::star))
        .route("/:id/open-with",                patch(files::set_open_with))
        .route("/:id/user-metadata",            patch(files::update_user_metadata))
        .route("/:id/copy",                     post(files::copy_file))
        .route("/compress",                     post(files::compress))
        .route("/archive/compress-save",        post(archive::compress_save))
        .route("/:id/decompress",               post(archive::decompress))
        .route("/:id/archive/list",             get(archive::list_archive))
        .route("/:id/archive/file",             get(archive::get_archive_file))
        .route("/:id/content",                  put(files::replace_content)
                                                    .layer(DefaultBodyLimit::max(state.settings.files.max_upload_bytes as usize)))
        .route("/:id/transform",                post(transform::transform))
        .route("/:id/versioning",               patch(versions::set_file_versioning))
        .route("/:id/activity",                 get(activity::file_activity))
        .route("/:id/info-extra",               get(activity::file_info_extra))
        // Versions
        .route("/:id/versions",                 get(versions::list).post(versions::create))
        .route("/:id/versions/:vid/restore",    post(versions::restore))
        .route("/:id/versions/:vid",            delete(versions::delete))
        // Partages
        .route("/shares",                       get(shares::list).post(shares::create))
        .route("/shares/recipients",            get(shares::search_recipients))
        .route("/shares/:id",                   delete(shares::revoke))
        // Connexions distantes (remote storage)
        .route("/remotes",                           get(remotes::list_connections).post(remotes::create_connection))
        .route("/remotes/:id",                       delete(remotes::delete_connection))
        .route("/remotes/:id/test",                  post(remotes::test_connection))
        .route("/remotes/:id/browse",                get(remotes::list_remote_root))
        .route("/remotes/:id/browse/*path",          get(remotes::list_remote_dir))
        .route("/remotes/:id/file/*path",            get(remotes::get_remote_file))
        .route("/remotes/:id/upload/*path",          post(remotes::upload_remote))
        .route("/remotes/:id/mkdir/*path",           post(remotes::create_remote_dir))
        .route("/remotes/:id/entry/*path",           delete(remotes::delete_remote_entry))
        .route("/remotes/:id/rename/*path",          post(remotes::rename_remote_entry))
        // Répertoire SYSTÈME (partagé) : lecture pour tous, écriture admins (gardée dans les handlers)
        .route("/system/folders",               get(system::list_folders).post(system::create_folder))
        .route("/system/folders/:id",           get(system::get_folder).delete(system::delete_folder))
        .route("/system/files",                 get(system::list_files))
        .route("/system/files/:id/download",    get(system::download))
        .route("/system/files/:id",             delete(system::delete_file))
        .route("/system/upload",                post(system::upload)
                                                    .layer(DefaultBodyLimit::max(state.settings.files.max_upload_bytes as usize)))
        // Synchro delta + écriture conflit-safe (clients offline-first natifs/desktop)
        .route("/sync/delta",                   get(sync::delta))
        .route("/sync/file/:id/content",        put(sync::put_content)
                                                    .layer(DefaultBodyLimit::max(state.settings.files.max_upload_bytes as usize)))
        // WebDAV token management
        .route("/webdav-token",                 get(webdav::get_webdav_token))
        .route("/webdav-token/regenerate",      post(webdav::regenerate_webdav_token))
        // Uploads multipart
        .route("/uploads",                      post(uploads::init))
        .route("/uploads/:id",                  get(uploads::status))
        .route("/uploads/:id/complete",         post(uploads::complete))
        .route("/uploads/:id/abort",            post(uploads::abort))
        .route("/uploads/:session_id/chunks/:chunk_index", post(uploads::upload_chunk)
                                                            .layer(DefaultBodyLimit::max(state.settings.files.chunk_size as usize)))
        .layer(middleware::from_fn_with_state(state.clone(), require_auth))
        // Idempotence des écritures (rejeu offline sans duplication).
        .layer(middleware::from_fn_with_state(state.clone(), crate::middleware::idempotency::idempotency))
        .with_state(state.clone());

    // Scan (sans auth — appelé par le core ou en local; protéger par réseau en prod)
    let system_authed = Router::new()
        .route("/scan", post(scan::scan))
        .with_state(state.clone());

    // WebDAV protocol (Basic Auth inside the handler, no JWT middleware)
    let webdav_routes = Router::new()
        .route("/webdav",       axum::routing::any(webdav::webdav_dispatch))
        .route("/webdav/",      axum::routing::any(webdav::webdav_dispatch))
        .route("/webdav/*path", axum::routing::any(webdav::webdav_dispatch))
        .with_state(state.clone());

    // Routes publiques (partages par token)
    let public = Router::new()
        .route("/share/:token",          get(public::get_share_info))
        .route("/share/:token/download", get(public::download_shared))
        .with_state(state.clone());

    // IPC — accès inter-modules (protégé par X-Internal-Secret)
    let ipc_routes = Router::new()
        .route("/ipc/folders",                   post(ipc::create_folder))
        .route("/ipc/folders/ensure-path",        post(ipc::ensure_folder_path))
        .route("/ipc/folders/:uid/:id",           get(ipc::get_folder).delete(ipc::delete_folder))
        .route("/ipc/files",                      post(ipc::create_file).get(ipc::list_files))
        .route("/ipc/files/with-content",         post(ipc::create_file_with_content))
        .route("/ipc/files/:uid/:id",             get(ipc::get_file))
        .route("/ipc/files/:uid/:id/content",    get(ipc::get_file_content))
        .route("/ipc/files/:id",                  delete(ipc::delete_file))
        .route("/ipc/files/:id/move",             patch(ipc::move_file))
        .route("/ipc/files/:id/rename",           patch(ipc::rename_file))
        .route("/ipc/files/names",                post(ipc::file_names))
        .route("/ipc/files/:id/content",          put(ipc::update_file_content))
        .route("/ipc/files/:id/protect",          patch(ipc::set_file_protected))
        .route("/ipc/folders/:id/protect",        patch(ipc::set_folder_protected))
        .layer(middleware::from_fn_with_state(state.clone(), require_ipc_secret))
        .with_state(state.clone());

    // Health check (sans auth)
    let system = Router::new()
        .route("/health", get(health::health))
        .with_state(state);

    Router::new()
        .merge(system)
        .merge(system_authed)
        .merge(public)
        .merge(webdav_routes)
        .merge(ipc_routes)
        .nest("/", authed)
        // Désactiver la limite globale de 2 Mo imposée par axum,
        // remplacée par des limites par route (upload, chunks).
        .layer(DefaultBodyLimit::disable())
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
}
