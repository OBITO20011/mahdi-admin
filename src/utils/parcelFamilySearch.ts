import {normalizeCatalogSearch} from '../../customer-web/src/utils/catalogView';

/** Same catalog normalization, with the owner's requested ة/ه equivalence.
 * Search keys only: stored names and SKUs are never changed. */
export const parcelFamilySearchKey=(value:string)=>normalizeCatalogSearch(value).replace(/ة/gu,'ه').replace(/\s+/gu,' ');
export function filterParcelFamilies<T extends {nameAr:string;sku:string}>(families:readonly T[],query:string):readonly T[]{
  const key=parcelFamilySearchKey(query);
  return key?families.filter(p=>parcelFamilySearchKey(p.nameAr).includes(key)||parcelFamilySearchKey(p.sku).includes(key)):families;
}
