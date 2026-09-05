import type { Order, Product } from '../types';

export interface ModalProductIdPayload {
  productId: string;
}

export interface StockAdjustmentModalPayload {
  product: Product;
  mode?: 'add' | 'deduct';
}

type ModalPayloadContract<
  Payload,
  Requirement extends 'none' | 'optional' | 'required',
> = {
  payload: Payload;
  requirement: Requirement;
};

/** Single source of truth for every modal identity and payload contract. */
export interface ModalPayloadMap {
  add_product: ModalPayloadContract<null, 'none'>;
  edit_product: ModalPayloadContract<Product, 'required'>;
  view_product: ModalPayloadContract<Product, 'required'>;
  adjust_stock: ModalPayloadContract<StockAdjustmentModalPayload, 'required'>;
  receive_goods: ModalPayloadContract<ModalProductIdPayload | null, 'optional'>;
  warehouse_transfer: ModalPayloadContract<ModalProductIdPayload | null, 'optional'>;
  stock_count: ModalPayloadContract<ModalProductIdPayload | null, 'optional'>;
  manage_categories: ModalPayloadContract<null, 'none'>;
  manage_brands: ModalPayloadContract<null, 'none'>;
  manage_units: ModalPayloadContract<null, 'none'>;
  profile: ModalPayloadContract<null, 'none'>;
  profile_settings: ModalPayloadContract<null, 'none'>;
  storefront_settings: ModalPayloadContract<null, 'none'>;
  inventory_opening_setup: ModalPayloadContract<null, 'none'>;
  promotion_codes: ModalPayloadContract<null, 'none'>;
  view_order: ModalPayloadContract<Order, 'required'>;
  add_expense: ModalPayloadContract<null, 'none'>;
  record_customer_payment: ModalPayloadContract<null, 'none'>;
  notifications: ModalPayloadContract<null, 'none'>;
  add_customer: ModalPayloadContract<null, 'none'>;
}

export type ModalName = keyof ModalPayloadMap;
export type ModalPayload = ModalPayloadMap[ModalName]['payload'];

export type ModalNameCallableWithoutPayload = {
  [Name in ModalName]: ModalPayloadMap[Name]['requirement'] extends
    | 'none'
    | 'optional'
    ? Name
    : never;
}[ModalName];

type ModalOpenArgumentsFor<Name extends ModalName> =
  ModalPayloadMap[Name]['requirement'] extends 'none'
    ? [modalName: Name]
    : ModalPayloadMap[Name]['requirement'] extends 'optional'
      ? [modalName: Name, data?: ModalPayloadMap[Name]['payload']]
      : [modalName: Name, data: ModalPayloadMap[Name]['payload']];

export type ModalOpenArguments = {
  [Name in ModalName]: ModalOpenArgumentsFor<Name>;
}[ModalName];

type UnionToIntersection<Union> = (
  Union extends unknown ? (value: Union) => void : never
) extends (value: infer Intersection) => void
  ? Intersection
  : never;

type ModalOpenOverloads = UnionToIntersection<{
  [Name in ModalName]: (...args: ModalOpenArgumentsFor<Name>) => void;
}[ModalName]>;

export type OpenModal = ModalOpenOverloads &
  ((modalName: ModalNameCallableWithoutPayload) => void);

export function isProductModalPayload(
  payload: ModalPayload,
): payload is Product {
  return payload !== null && 'sku' in payload;
}

export function isOrderModalPayload(payload: ModalPayload): payload is Order {
  return payload !== null && 'orderNumber' in payload;
}

export function isProductIdModalPayload(
  payload: ModalPayload,
): payload is ModalProductIdPayload {
  return payload !== null && 'productId' in payload;
}

export function isStockAdjustmentModalPayload(
  payload: ModalPayload,
): payload is StockAdjustmentModalPayload {
  return payload !== null && 'product' in payload;
}
