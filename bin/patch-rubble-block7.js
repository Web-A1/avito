#!/usr/bin/env node
/**
 * Точечно обновляет Блок 7 в описаниях щебня внутри готового XML.
 * Использует ту же рандомную генерацию, что и генератор объявлений,
 * и сохраняет результат в новый файл (по умолчанию ads_19.12.xml_2).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateRubbleBlock7Params } from '../src/generators/materials/rubble/block7Generator.js';
import { RUBBLE_BLOCK_7_TEMPLATE_HTML } from '../src/constants/blocks.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_INPUT = path.resolve(__dirname, '..', 'output', 'ads_19.12.xml');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { input: DEFAULT_INPUT, output: '' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) {
      opts.input = path.resolve(args[++i]);
    } else if (args[i] === '--output' && args[i + 1]) {
      opts.output = path.resolve(args[++i]);
    }
  }
  if (!opts.output) {
    opts.output = `${opts.input}_2`;
  }
  return opts;
}

function isRubbleAd(adBlock) {
  return /<BulkMaterialType>\s*Щебень,?\s*гравий\s*<\/BulkMaterialType>/i.test(adBlock);
}

function extractDescription(adBlock) {
  const match = adBlock.match(/<Description><!\[CDATA\[(?<desc>[\s\S]*?)\]\]><\/Description>/);
  if (!match || !match.groups) return null;
  return { full: match[0], content: match.groups.desc };
}

function extractFractionLabel(adBlock, description = '') {
  const fractionTag = adBlock.match(/<Fraction>([^<]+)<\/Fraction>/i);
  if (fractionTag && fractionTag[1]) {
    return normalizeFraction(fractionTag[1]);
  }

  const descMatch = description.match(/(\d{1,3})[–-](\d{1,3})\s*мм?/i);
  if (descMatch) {
    return normalizeFraction(`${descMatch[1]}–${descMatch[2]} мм`);
  }

  return '';
}

function normalizeFraction(raw = '') {
  const withDash = raw.replace(/-/g, '–').replace(/\s+/g, ' ').trim();
  return /мм$/i.test(withDash) ? withDash : `${withDash} мм`;
}

function detectRubbleTypeId(fractionLabel = '') {
  if (fractionLabel.includes('5–20')) return 'scheben_vtorichnyi_5_20';
  if (fractionLabel.includes('40–70')) return 'scheben_vtorichnyi_40_70';
  return 'scheben_vtorichnyi_40_70';
}

function buildMaterialLabel(fractionLabel = '') {
  const cleaned = fractionLabel.replace(/\s*мм$/i, '');
  return cleaned ? `Щебень вторичный ${cleaned}` : 'Щебень вторичный';
}

function replaceBlock7(description, newBlock7Html) {
  const lastPOpen = description.lastIndexOf('<p');
  const lastPClose = description.lastIndexOf('</p>');
  if (lastPOpen === -1 || lastPClose === -1 || lastPOpen > lastPClose) {
    return null;
  }
  return (
    description.slice(0, lastPOpen) +
    newBlock7Html +
    description.slice(lastPClose + '</p>'.length)
  );
}

function processAd(adBlock) {
  if (!isRubbleAd(adBlock)) {
    return { updated: adBlock, changed: false };
  }

  const descInfo = extractDescription(adBlock);
  if (!descInfo) {
    return { updated: adBlock, changed: false };
  }

  const fractionLabel = extractFractionLabel(adBlock, descInfo.content);
  const rubbleTypeId = detectRubbleTypeId(fractionLabel);
  const materialLabel = buildMaterialLabel(fractionLabel);

  const block7Params = generateRubbleBlock7Params(rubbleTypeId, {
    materialLabel,
    fractionLabel
  });
  const newBlock7Html = RUBBLE_BLOCK_7_TEMPLATE_HTML(block7Params);

  const updatedDescription = replaceBlock7(descInfo.content, newBlock7Html);
  if (!updatedDescription) {
    return { updated: adBlock, changed: false };
  }

  const updatedAd = adBlock.replace(
    descInfo.full,
    `<Description><![CDATA[${updatedDescription}]]></Description>`
  );

  return { updated: updatedAd, changed: true };
}

function main() {
  const { input, output } = parseArgs();
  if (!fs.existsSync(input)) {
    throw new Error(`Input XML not found: ${input}`);
  }

  const xml = fs.readFileSync(input, 'utf8');
  const adRegex = /<Ad>[\s\S]*?<\/Ad>/g;
  let changed = 0;

  const updatedXml = xml.replace(adRegex, (adBlock) => {
    const { updated, changed: isChanged } = processAd(adBlock);
    if (isChanged) changed += 1;
    return updated;
  });

  fs.writeFileSync(output, updatedXml, 'utf8');
  console.log(`Готово. Обновлено блоков щебня: ${changed}. Файл: ${output}`);
}

main();
