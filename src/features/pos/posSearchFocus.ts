export type PosAdditionSource = 'pointer' | 'search' | 'barcode';

/** Pointer additions on phones must not summon the software keyboard.
 * Explicit search/scanner additions keep their consecutive-input workflow. */
export function shouldRestorePosSearchFocus(source:PosAdditionSource,device:{coarse:boolean;touchPoints:number;width:number}) {
  return source!=='pointer'||(!device.coarse&&device.touchPoints===0&&device.width>=768);
}
