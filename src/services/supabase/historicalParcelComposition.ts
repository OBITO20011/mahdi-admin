import type { Order } from '../../types';

interface InstanceRow {
  id: string;
  order_item_id: string;
  instance_sequence: number;
  units_per_parcel_snapshot: number;
  parcel_unit_name_snapshot: string | null;
}

interface ComponentRow {
  id: string;
  parcel_instance_id: string;
  product_id: string;
  base_quantity: number;
  product_name_snapshot: string;
  sku_snapshot: string;
  base_unit_name_snapshot: string;
}

/** Display immutable order composition, never current product/flavor configuration. */
export function attachHistoricalParcelComposition(
  order: Order,
  instances: InstanceRow[],
  components: ComponentRow[],
): void {
  for (const item of order.items) {
    if (item.commercialLineKind !== 'configurable_parcel') continue;
    const ownInstances = instances.filter((instance) => instance.order_item_id === item.id);
    if (ownInstances.length !== item.quantity) {
      throw new Error('تركيبة الطرد التاريخية غير مكتملة؛ لا يمكن عرض طلب التجهيز بأمان.');
    }
    item.parcelInstances = ownInstances.map((instance) => {
      const ownComponents = components.filter((component) => component.parcel_instance_id === instance.id);
      const expected = Number(instance.units_per_parcel_snapshot);
      if (ownComponents.length === 0
        || ownComponents.reduce((sum, component) => sum + Number(component.base_quantity), 0) !== expected) {
        throw new Error('مكونات الطرد التاريخية غير متطابقة؛ راجع الطلب قبل تجهيزه.');
      }
      return {
        id: instance.id,
        sequence: Number(instance.instance_sequence),
        unitName: instance.parcel_unit_name_snapshot || 'طرد',
        components: ownComponents.map((component) => ({
          id: component.id,
          productId: component.product_id,
          name: component.product_name_snapshot,
          sku: component.sku_snapshot,
          unitName: component.base_unit_name_snapshot,
          quantity: Number(component.base_quantity),
        })),
      };
    });
  }
}
