export interface AnnotationXmlBatchItem {
  id: number;
  text: string;
}

interface AnnotationXmlBatchOptions {
  rootName?: string;
  itemName?: string;
  textName?: string;
}

export const MIN_XML_BATCH_SIZE = 3;
export const MAX_XML_BATCH_SIZE = 20;

const defaultXmlNames = {
  rootName: "annotations",
  itemName: "item",
  textName: "text"
};

export function clampXmlBatchSize(value: number) {
  if (!Number.isFinite(value)) return MIN_XML_BATCH_SIZE;
  return Math.min(MAX_XML_BATCH_SIZE, Math.max(MIN_XML_BATCH_SIZE, Math.round(value)));
}

function resolveXmlNames(options: AnnotationXmlBatchOptions = {}) {
  return {
    rootName: options.rootName ?? defaultXmlNames.rootName,
    itemName: options.itemName ?? defaultXmlNames.itemName,
    textName: options.textName ?? defaultXmlNames.textName
  };
}

function escapeXmlText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeXmlAttribute(value: string) {
  return escapeXmlText(value).replace(/"/g, "&quot;");
}

function stripMarkdownCodeFence(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:xml)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

export function buildAnnotationXmlBatch(
  items: AnnotationXmlBatchItem[],
  options?: AnnotationXmlBatchOptions
) {
  const { rootName, itemName, textName } = resolveXmlNames(options);
  const rows = items
    .map(
      (item) =>
        `  <${itemName} id="${escapeXmlAttribute(String(item.id))}"><${textName}>${escapeXmlText(
          item.text
        )}</${textName}></${itemName}>`
    )
    .join("\n");
  return `<${rootName}>\n${rows}\n</${rootName}>`;
}

export function parseAnnotationXmlBatchResponse(
  response: string,
  expectedIds: number[],
  options?: AnnotationXmlBatchOptions
): Map<number, string> {
  const { rootName, itemName, textName } = resolveXmlNames(options);
  const xml = stripMarkdownCodeFence(response);
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const parserError = document.querySelector("parsererror");
  if (parserError) {
    throw new Error("LLM returned invalid XML.");
  }

  const root = document.documentElement;
  if (root.nodeName !== rootName) {
    throw new Error(`LLM XML response must use <${rootName}> as the root element.`);
  }

  const expectedIdSet = new Set(expectedIds);
  const results = new Map<number, string>();
  for (const item of Array.from(root.children).filter(
    (child) => child.nodeName === itemName
  )) {
    const idValue = item.getAttribute("id");
    const id = Number(idValue);
    if (!Number.isInteger(id) || !expectedIdSet.has(id)) {
      throw new Error(`LLM XML response contains an unexpected item id: ${idValue ?? ""}`);
    }
    if (results.has(id)) {
      throw new Error(`LLM XML response contains a duplicate item id: ${id}`);
    }

    const textElement = Array.from(item.children).find(
      (child) => child.nodeName === textName
    );
    if (!textElement) {
      throw new Error(`LLM XML response is missing <${textName}> for item id: ${id}`);
    }
    results.set(id, textElement.textContent ?? "");
  }

  const missingId = expectedIds.find((id) => !results.has(id));
  if (missingId !== undefined) {
    throw new Error(`LLM XML response is missing item id: ${missingId}`);
  }

  return results;
}
