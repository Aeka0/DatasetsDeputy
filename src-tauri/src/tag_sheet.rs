use crate::errors::AppResult;
use serde::Serialize;
use std::{collections::HashMap, sync::OnceLock};

const DANBOORU_FULL_CSV: &str = include_str!("../../assets/tagsheet/danbooru-full.csv");

static DANBOORU_TAG_CATEGORIES: OnceLock<HashMap<String, DanbooruTagCategory>> = OnceLock::new();

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DanbooruTagCategory {
    General,
    Artist,
    Copyright,
    Character,
    Meta,
    Unknown,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DanbooruTagCategoryLookup {
    pub tag: String,
    pub category: DanbooruTagCategory,
}

fn normalize_booru_tag(value: &str) -> String {
    value.trim().replace(' ', "_").to_lowercase()
}

fn category_from_code(value: &str) -> DanbooruTagCategory {
    match value {
        "0" => DanbooruTagCategory::General,
        "1" => DanbooruTagCategory::Artist,
        "3" => DanbooruTagCategory::Copyright,
        "4" => DanbooruTagCategory::Character,
        "5" => DanbooruTagCategory::Meta,
        _ => DanbooruTagCategory::Unknown,
    }
}

fn danbooru_tag_categories() -> &'static HashMap<String, DanbooruTagCategory> {
    DANBOORU_TAG_CATEGORIES.get_or_init(|| {
        let mut tags = HashMap::new();

        for line in DANBOORU_FULL_CSV.lines() {
            let mut fields = line.splitn(3, ',');
            if let (Some(tag), Some(category)) = (fields.next(), fields.next()) {
                let normalized_tag = normalize_booru_tag(tag);
                if !normalized_tag.is_empty() {
                    tags.insert(normalized_tag, category_from_code(category));
                }
            }
        }

        tags
    })
}

pub fn danbooru_style_tags() -> AppResult<Vec<String>> {
    let tags = danbooru_tag_categories()
        .iter()
        .filter_map(|(tag, category)| {
            (*category == DanbooruTagCategory::Artist).then(|| tag.clone())
        })
        .collect();

    Ok(tags)
}

pub fn lookup_danbooru_tag_categories(
    tags: Vec<String>,
) -> AppResult<Vec<DanbooruTagCategoryLookup>> {
    let categories = danbooru_tag_categories();

    Ok(tags
        .into_iter()
        .map(|tag| {
            let normalized_tag = normalize_booru_tag(&tag);
            DanbooruTagCategoryLookup {
                tag: normalized_tag.clone(),
                category: categories
                    .get(&normalized_tag)
                    .copied()
                    .unwrap_or(DanbooruTagCategory::Unknown),
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::{
        danbooru_style_tags, lookup_danbooru_tag_categories, normalize_booru_tag,
        DanbooruTagCategory,
    };

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

    #[test]
    fn looks_up_known_tag_categories() {
        let lookups = lookup_danbooru_tag_categories(vec![
            "1girl".to_string(),
            "kantoku".to_string(),
            "touhou".to_string(),
            "hakurei_reimu".to_string(),
            "not_a_real_tag_for_this_sheet".to_string(),
        ])
        .expect("tag categories should load");

        assert_eq!(lookups[0].category, DanbooruTagCategory::General);
        assert_eq!(lookups[1].category, DanbooruTagCategory::Artist);
        assert_eq!(lookups[2].category, DanbooruTagCategory::Copyright);
        assert_eq!(lookups[3].category, DanbooruTagCategory::Character);
        assert_eq!(lookups[4].category, DanbooruTagCategory::Unknown);
        assert_eq!(super::category_from_code("5"), DanbooruTagCategory::Meta);
    }
}
