export const phase6AftercareFixture = {
  contractVersion: 403, supported: true, capability: 'phase43_modern',
  order: {id: '66660000-0000-4000-8000-000000000002', orderNumber: 'P6-B', withinWindow: true, deadlineAt: '2026-10-08T08:00:00Z'},
  financial: {merchandiseDebtInMinorUnits: 0, refundableCollectedInMinorUnits: 5000, deliveryFeeInMinorUnits: 0},
  baseItems: [{orderItemId: 'base-root', productId: 'juice', quantity: 5, remainingQuantity: 5,
    physicalRepresentatives: [
      {sourceKind: 'base_order_item', sourceId: 'a', productId: 'juice', remainingQuantity: 2, parentReplacementItemId: null},
      {sourceKind: 'replacement_item', sourceId: 'b', productId: 'juice', remainingQuantity: 3, parentReplacementItemId: 'prior'},
    ]}],
  parcelInstances: [{orderItemId: 'parcel-root', parcelInstanceId: 'parcel', components: [
    {parcelComponentId: 'component', productId: 'juice', quantity: 3, physicalRepresentatives: [
      {sourceKind: 'replacement_item', sourceId: 'leaf', productId: 'juice', remainingQuantity: 3, parentReplacementItemId: 'old-leaf'},
    ]},
  ]}], returns: [], replacements: [
    {operationalStatus: 'issued', issuedAt: '2026-10-01T10:00:00Z', items: [
      {replacementItemId: 'prior', parentReplacementItemId: null, rootOrderItemId: 'base-root'},
    ]},
    {operationalStatus: 'issued', issuedAt: '2026-10-02T10:00:00Z', items: [
      {replacementItemId: 'b', parentReplacementItemId: 'prior', rootOrderItemId: 'base-root'},
    ]},
  ],
};
