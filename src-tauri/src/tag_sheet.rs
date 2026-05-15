use crate::errors::AppResult;

const DANBOORU_FULL_CSV: &str = include_str!("../../assets/tagsheet/danbooru-full.csv");

fn normalize_booru_tag(value: &str) -> String {
    value.trim().replace(' ', "_").to_lowercase()
}

pub fn danbooru_style_tags() -> AppResult<Vec<String>> {
    let mut tags = Vec::new();

    for line in DANBOORU_FULL_CSV.lines() {
        let mut fields = line.splitn(3, ',');
        if let (Some(tag), Some(category)) = (fields.next(), fields.next()) {
            if category == "1" {
                tags.push(normalize_booru_tag(tag));
            }
        }
    }

    Ok(tags)
}

#[cfg(test)]
mod tests {
    use super::{danbooru_style_tags, normalize_booru_tag};

    #[test]
    fn normalizes_case_and_space_variants() {
        assert_eq!(normalize_booru_tag(" Artist Name "), "artist_name");
        assert_eq!(normalize_booru_tag("artist_name"), "artist_name");
        assert_eq!(normalize_booru_tag("ARTIST NAME"), "artist_name");
    }

    #[test]
    fn loads_style_tags_from_rows_with_dirty_alias_columns() {
        let tags = danbooru_style_tags().expect("tag sheet should load");
        assert!(tags.len() > 40_000);
    }
}
