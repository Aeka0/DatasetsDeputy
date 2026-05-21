export type AnnotationFormat = "unset" | "booruTag" | "anima" | "naturalLanguage";
export type UsableAnnotationFormat = Exclude<AnnotationFormat, "unset">;
export type AnnotationFormatConversionKey =
  `${UsableAnnotationFormat}->${UsableAnnotationFormat}`;

export type QualityWordPlacement = "none" | "keep" | "prefix" | "suffix" | "off";

export interface AnnotationFormatConversionOptions {
  qualityWordPlacement: QualityWordPlacement;
}

export interface AnnotationFormatConversionDependencies {
  loadDanbooruStyleTags: () => Promise<Set<string>>;
}

export interface AnnotationFormatConversionContext {
  styleTags?: Set<string>;
}

export interface AnnotationFormatConverter {
  key: AnnotationFormatConversionKey;
  prepare?: (
    dependencies: AnnotationFormatConversionDependencies
  ) => Promise<AnnotationFormatConversionContext>;
  convert: (
    content: string,
    options: AnnotationFormatConversionOptions,
    context: AnnotationFormatConversionContext
  ) => string;
}
