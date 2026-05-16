import { animaToBooruTagConverter } from "./converters/animaToBooruTag";
import { booruTagToAnimaConverter } from "./converters/booruTagToAnima";
import type {
  AnnotationFormatConversionContext,
  AnnotationFormatConversionDependencies,
  AnnotationFormatConversionKey,
  AnnotationFormatConverter,
  UsableAnnotationFormat
} from "./types";

const converters: AnnotationFormatConverter[] = [
  booruTagToAnimaConverter,
  animaToBooruTagConverter
];

const converterByKey = new Map<AnnotationFormatConversionKey, AnnotationFormatConverter>(
  converters.map((converter) => [converter.key, converter])
);

export function buildAnnotationFormatConversionKey(
  currentFormat: UsableAnnotationFormat,
  targetFormat: UsableAnnotationFormat
): AnnotationFormatConversionKey {
  return `${currentFormat}->${targetFormat}`;
}

export function getAnnotationFormatConverter(
  currentFormat: UsableAnnotationFormat,
  targetFormat: UsableAnnotationFormat
) {
  return converterByKey.get(
    buildAnnotationFormatConversionKey(currentFormat, targetFormat)
  );
}

export async function prepareAnnotationFormatConversion(
  converter: AnnotationFormatConverter,
  dependencies: AnnotationFormatConversionDependencies
): Promise<AnnotationFormatConversionContext> {
  return converter.prepare ? converter.prepare(dependencies) : {};
}
