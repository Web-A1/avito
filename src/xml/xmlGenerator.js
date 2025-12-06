/**
 * Генератор XML для Авито.
 * Принимает массив объявлений и возвращает строку XML (<Ads><Ad>…</Ad></Ads>).
 */

import { FIXED_PARAMETERS } from '../constants/parameters.js';

function escapeXml(str = '') {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapCdata(content = '') {
  return `<![CDATA[${content}]]>`;
}

function formatImages(images = []) {
  if (!images.length) return '';
  return `<Images>${images.map((url) => `<Image url="${escapeXml(url)}"/>`).join('')}</Images>`;
}

function formatAd(ad, idx, dateLabel = '') {
  const existingId = ad.Id || ad.id;
  const id = existingId || `sand_${dateLabel}_${idx + 1}`;
  const fixed = ad.fixed || {};
  const images = ad.photoLink ? [ad.photoLink] : [];
  const description = wrapCdata(ad.description || '');
  const bulkMaterialType = ad.bulkMaterialType || 'Песок';
  const bulkMaterialSubType = ad.bulkMaterialSubType || FIXED_PARAMETERS.BULK_MATERIAL_SUBTYPE;
  const packagingType = ad.packagingType || FIXED_PARAMETERS.PACKAGING_TYPE;
  const availability = ad.availability || FIXED_PARAMETERS.AVAILABILITY;
  const compactionCoefficient =
    ad.compactionCoefficient ?? fixed.compactionCoefficient ?? '';
  const minSaleQuantity = ad.minSaleQuantity ?? FIXED_PARAMETERS.MIN_SALE_QUANTITY;
  const dateBegin = ad.dateBegin;

  return `
    <Ad>
      <Id>${escapeXml(id)}</Id>
      <Category>Ремонт и строительство</Category>
      <Title>${escapeXml(ad.title || '')}</Title>
      <Description>${description}</Description>
      <Address>${escapeXml(ad.address || '')}</Address>
      ${ad.price ? `<Price>${ad.price}</Price>` : ''}
      ${formatImages(images)}
      <GoodsType>Стройматериалы</GoodsType>
      <AdType>Товар от производителя</AdType>
      <Condition>Новое</Condition>
      <GoodsSubType>Сыпучие материалы</GoodsSubType>
      <BulkMaterialType>${escapeXml(bulkMaterialType)}</BulkMaterialType>
      <BulkMaterialSubType>${escapeXml(bulkMaterialSubType)}</BulkMaterialSubType>
      <PackagingType>${escapeXml(packagingType)}</PackagingType>
      <CompactionCoefficient>${compactionCoefficient}</CompactionCoefficient>
      <MinSaleQuantity>${minSaleQuantity}</MinSaleQuantity>
      <PriceFor>${escapeXml(ad.priceFor || '')}</PriceFor>
      ${ad.color ? `<Color>${escapeXml(ad.color)}</Color>` : ''}
      <Availability>${escapeXml(availability)}</Availability>
      ${dateBegin ? `<DateBegin>${escapeXml(dateBegin)}</DateBegin>` : ''}
    </Ad>`;
}

/**
 * Генерирует XML строку из списка объявлений.
 * @param {Object[]} ads - массив объявлений
 * @param {string} dateLabel - метка даты для Id (например, "05.12")
 * @returns {string} XML строка
 */
export function generateXml(ads = [], dateLabel = '') {
  const adsXml = ads.map((ad, idx) => formatAd(ad, idx, dateLabel)).join('');
  return `<Ads formatVersion="3" target="Avito.ru">${adsXml}\n</Ads>`;
}
