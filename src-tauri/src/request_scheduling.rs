pub const REQUEST_MODE_QUEUE: &str = "queue";
pub const REQUEST_MODE_CONCURRENT: &str = "concurrent";

pub fn default_target_rpm() -> u32 {
    5
}

pub fn default_request_mode() -> String {
    REQUEST_MODE_QUEUE.to_owned()
}

pub fn normalize_request_mode(mode: &mut String) {
    *mode = match mode.trim() {
        REQUEST_MODE_CONCURRENT => REQUEST_MODE_CONCURRENT.to_owned(),
        _ => REQUEST_MODE_QUEUE.to_owned(),
    };
}
