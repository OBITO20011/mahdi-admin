// Historic source pins include erased annotations and pre-narrowing spellings.
// Restore only this approved batch's spellings for those old pins. The separate
// strict-product-parity test verifies the real emitted bodies against f2c37bd.
export function strictProductLegacySource(file:string,source:string):string {
  source=approvedProductEditConflictSource(file,source.replaceAll('\r\n','\n'));
  if(file.endsWith('/CustomerDetailView.tsx'))source=source
    .replace('      const loadedCustomer = result.customer;\n','')
    .replaceAll('loadedCustomer','result.customer');
  if(file.endsWith('/DirectReceivingView.tsx'))source=source.replaceAll('Set<string | undefined>','Set<string>');
  if(file.endsWith('/ProductFormModal.tsx'))source=source
    .replace('file?: File | null','file?: File')
    .replace('let result: Awaited<ReturnType<typeof createProductFamilyWithFlavorsInSupabase>>;','let result;');
  if(file.endsWith('/CreatePurchaseOrderModal.tsx'))source=source
    .replace('let res: Awaited<ReturnType<typeof createPurchaseOrderInSupabase>>;','let res;');
  if(file.endsWith('/useAppStore.ts'))source=source.replaceAll("NonNullable<User['notificationSettings']>","User['notificationSettings']");
  if(file.startsWith('src/services/supabase/'))source=source
    .replaceAll('  const client = supabase;\n','')
    .replaceAll('!client','!supabase').replaceAll('client.','supabase.')
    .replaceAll('= client\n','= supabase\n').replaceAll('(client,','(supabase,');
  if(file.endsWith('/adminAssistant.service.ts'))source=source.replace("  if (!supabase) {\n    throw new Error('تعذر التواصل مع المساعد الآن.');\n  }\n\n",'');
  return source;
}

// Approved owner decision 2026-10-15 (migration 170, product edit conflict):
// these exact hunks are the only business changes made to these files. Each
// must appear exactly once; reverting them must give back the pre-170 source,
// so every other line stays under the original parity pins.
const productEditConflictHunks:Readonly<Record<string,readonly (readonly [string,string])[]>>={
 "src/features/products/ProductFormModal.tsx": [
  [
   "import { createProductFamilyWithFlavorsInSupabase } from '../../services/supabase/products.service';\nimport {\n  compareProductEdits,\n  reapplyProductEdits,\n  snapshotToEditFields,\n  type ProductEditComparisonRow,\n  type ProductEditFields,\n  type ProductEditSnapshot,\n} from '../../utils/productEditConflict';\nimport { ProductEditConflictPanel } from './ProductEditConflictPanel';\nimport { useAppStore } from '../../stores/useAppStore';\n",
   "import { createProductFamilyWithFlavorsInSupabase } from '../../services/supabase/products.service';\nimport { useAppStore } from '../../stores/useAppStore';\n"
  ],
  [
   "});\n\n// Marks a picked-but-not-yet-uploaded image in the conflict comparison.\nconst NEW_IMAGE_SELECTED = '\\u0000new-image';\n\n",
   "});\n\n"
  ],
  [
   "  } | null>(null);\n  // Optimistic concurrency (migration 170): the version and values this form\n  // opened, independent of later store refreshes.\n  const [openedVersion, setOpenedVersion] = useState(initialProduct?.updatedAt || '');\n  const [openedActive, setOpenedActive] = useState(initialProduct?.status !== 'hidden');\n  const [openedFields, setOpenedFields] = useState<ProductEditFields | null>(null);\n  const [editConflict, setEditConflict] = useState<{\n    snapshot: ProductEditSnapshot;\n    current: ProductEditFields;\n  } | null>(null);\n  const [reappliedNotice, setReappliedNotice] = useState(false);\n  const currentFlavors = useMemo(\n",
   "  } | null>(null);\n  const currentFlavors = useMemo(\n"
  ],
  [
   "\n  const readFormFields = (): ProductEditFields => ({\n    nameAr: nameAr.trim(),\n    description: description.trim(),\n    sku: sku.trim().toUpperCase(),\n    barcode: isFlavorMaster ? '' : barcode.trim(),\n    categoryId,\n    brandId,\n    imageUrl: selectedImageFile ? NEW_IMAGE_SELECTED : imageUrl.trim(),\n    purchasePackage,\n    unitsPerPackage: validUnitsPerPackage,\n    defaultPurchasePrice: validPackagePrice,\n    salePackage,\n    unitsPerSalePackage: validUnitsPerSalePackage,\n    salePackagePrice: validSalePackagePrice,\n    reorderPackages: Math.max(0, Math.floor(Number(reorderLevel) || 0)),\n    maxPackages:\n      maxStockLevel === '' ? '' : Math.max(0, Math.floor(Number(maxStockLevel) || 0)),\n  });\n\n  // Capture the values exactly as the form initialised them, once.\n  useEffect(() => {\n    if (isEditing) setOpenedFields(readFormFields());\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, []);\n\n  const applyFormFields = (fields: ProductEditFields, currentImageUrl: string) => {\n    setNameAr(fields.nameAr);\n    setDescription(fields.description);\n    setSku(fields.sku);\n    if (!isFlavorMaster) setBarcode(fields.barcode);\n    setCategoryId(fields.categoryId);\n    setBrandId(fields.brandId);\n    // A newly picked image stays selected and is uploaded again on save.\n    setImageUrl(fields.imageUrl === NEW_IMAGE_SELECTED ? currentImageUrl : fields.imageUrl);\n    setPurchasePackage(fields.purchasePackage);\n    setUnitsPerPackage(fields.unitsPerPackage);\n    setDefaultPurchasePrice(fields.defaultPurchasePrice);\n    setUnitPurchasePrice(calculateUnitCost(fields.defaultPurchasePrice, fields.unitsPerPackage));\n    setLastPurchasePriceEdited('package');\n    setSalePackage(fields.salePackage);\n    setUnitsPerSalePackage(fields.unitsPerSalePackage);\n    setSalePackagePrice(fields.salePackagePrice);\n    setReorderLevel(fields.reorderPackages);\n    setMaxStockLevel(fields.maxPackages);\n  };\n\n  const conflictRows = editConflict && openedFields\n    ? compareProductEdits(openedFields, readFormFields(), editConflict.current)\n    : [];\n\n  const formatConflictValue = (\n    row: ProductEditComparisonRow,\n    value: ProductEditComparisonRow['mine']\n  ) => {\n    if (row.field === 'imageUrl') {\n      return value === NEW_IMAGE_SELECTED ? 'صورة جديدة مختارة' : value ? 'صورة محفوظة' : 'بدون صورة';\n    }\n    if (row.field === 'categoryId') {\n      return categories.find((category) => category.id === value)?.nameAr || '—';\n    }\n    if (row.field === 'brandId') {\n      return brands.find((brand) => brand.id === value)?.nameAr || 'بدون ماركة';\n    }\n    if (row.field === 'defaultPurchasePrice' || row.field === 'salePackagePrice') {\n      return `${formatJod(Number(value) || 0)} ${CURRENCY}`;\n    }\n    return value === '' || value === null || value === undefined ? '—' : String(value);\n  };\n\n  const reapplyMyEdits = () => {\n    if (!editConflict || !openedFields) return;\n    const merged = reapplyProductEdits(openedFields, readFormFields(), editConflict.current);\n    applyFormFields(merged, editConflict.current.imageUrl);\n    setOpenedFields(editConflict.current);\n    setOpenedVersion(editConflict.snapshot.updatedAt);\n    setOpenedActive(editConflict.snapshot.isActive);\n    setEditConflict(null);\n    setReappliedNotice(true);\n  };\n\n  const handleSubmit = async (event: React.FormEvent) => {\n",
   "\n  const handleSubmit = async (event: React.FormEvent) => {\n"
  ],
  [
   "    setSubmitError(null);\n    setReappliedNotice(false);\n\n",
   "    setSubmitError(null);\n\n"
  ],
  [
   "      maxStockLevel: maxLevel,\n      // The form has no visibility control: an edit keeps the visibility it\n      // opened with (or the current one after re-applying a conflict).\n      status: isEditing && !openedActive ? 'hidden' : 'active',\n    };\n",
   "      maxStockLevel: maxLevel,\n      status: 'active',\n    };\n"
  ],
  [
   "          isEditing && initialProduct?.id\n            ? await updateProduct(initialProduct.id, payload, {\n                expectedUpdatedAt: openedVersion,\n              })\n            : await addProduct(payload);\n",
   "          isEditing && initialProduct?.id\n            ? await updateProduct(initialProduct.id, payload)\n            : await addProduct(payload);\n"
  ],
  [
   "      await cleanupUploadedImages();\n\n      if (result?.errorDetails?.code === 'PRODUCT_EDIT_CONFLICT' && 'conflict' in result && result.conflict) {\n        setEditConflict({\n          snapshot: result.conflict,\n          current: snapshotToEditFields(result.conflict),\n        });\n        return;\n      }\n\n",
   "      await cleanupUploadedImages();\n\n"
  ],
  [
   "\n      {editConflict && (\n        <ProductEditConflictPanel\n          rows={conflictRows}\n          statusChange={\n            editConflict.snapshot.isActive !== openedActive\n              ? { mine: openedActive, current: editConflict.snapshot.isActive }\n              : undefined\n          }\n          formatValue={formatConflictValue}\n          onReapply={reapplyMyEdits}\n        />\n      )}\n\n      {reappliedNotice && (\n        <p role=\"status\" data-testid=\"product-edit-reapplied\" className=\"rounded-2xl border border-nw-border bg-nw-info-bg p-3 text-sm font-bold text-nw-info\">\n          طُبّقت تعديلاتك فوق القيم الحالية. راجعها ثم اضغط «حفظ التعديلات».\n        </p>\n      )}\n\n      {submitError && (\n",
   "\n      {submitError && (\n"
  ]
 ],
 "src/features/products/ProductDetailModal.tsx": [
  [
   "import { useAppStore } from '../../stores/useAppStore';\nimport type { ProductEditComparisonRow, ProductEditSnapshot } from '../../utils/productEditConflict';\nimport { ProductEditConflictPanel } from './ProductEditConflictPanel';\nimport { Product } from '../../types';\n",
   "import { useAppStore } from '../../stores/useAppStore';\nimport { Product } from '../../types';\n"
  ],
  [
   "  const [editFlavorImagePreview, setEditFlavorImagePreview] = useState('');\n  // Version and values the flavor edit started from (migration 170).\n  const [flavorOpened, setFlavorOpened] = useState<{\n    version: string;\n    name: string;\n    barcode: string;\n    active: boolean;\n  } | null>(null);\n  const [flavorConflict, setFlavorConflict] = useState<ProductEditSnapshot | null>(null);\n  const [isUpdatingFlavor, setIsUpdatingFlavor] = useState(false);\n",
   "  const [editFlavorImagePreview, setEditFlavorImagePreview] = useState('');\n  const [isUpdatingFlavor, setIsUpdatingFlavor] = useState(false);\n"
  ],
  [
   "    setEditFlavorImagePreview('');\n    setFlavorOpened(null);\n    setFlavorConflict(null);\n    setBarcodeCameraTarget((target) => (target === 'edit' ? null : target));\n",
   "    setEditFlavorImagePreview('');\n    setBarcodeCameraTarget((target) => (target === 'edit' ? null : target));\n"
  ],
  [
   "    setEditFlavorActive(flavor.status !== 'hidden');\n    setFlavorOpened({\n      version: flavor.updatedAt,\n      name: flavor.flavorNameAr || '',\n      barcode: flavor.barcode || '',\n      active: flavor.status !== 'hidden',\n    });\n  };\n\n  const flavorConflictRows = (): ProductEditComparisonRow[] => {\n    if (!flavorConflict || !flavorOpened) return [];\n    const rows: ProductEditComparisonRow[] = [\n      { field: 'nameAr', label: 'اسم النكهة', mine: editFlavorName.trim(), current: flavorConflict.flavorNameAr,\n        changedByMe: editFlavorName.trim() !== flavorOpened.name, changedByOther: flavorConflict.flavorNameAr !== flavorOpened.name },\n      { field: 'barcode', label: 'الباركود', mine: editFlavorBarcode.trim(), current: flavorConflict.barcode,\n        changedByMe: editFlavorBarcode.trim() !== flavorOpened.barcode, changedByOther: flavorConflict.barcode !== flavorOpened.barcode },\n    ];\n    return rows.filter((row) => row.changedByMe || row.changedByOther);\n  };\n\n  const reapplyFlavorEdits = () => {\n    if (!flavorConflict || !flavorOpened) return;\n    // My changed fields over the current values; untouched fields take the current value.\n    if (editFlavorName.trim() === flavorOpened.name) setEditFlavorName(flavorConflict.flavorNameAr);\n    if (editFlavorBarcode.trim() === flavorOpened.barcode) setEditFlavorBarcode(flavorConflict.barcode);\n    if (editFlavorActive === flavorOpened.active) setEditFlavorActive(flavorConflict.isActive);\n    setFlavorOpened({\n      version: flavorConflict.updatedAt,\n      name: flavorConflict.flavorNameAr,\n      barcode: flavorConflict.barcode,\n      active: flavorConflict.isActive,\n    });\n    setFlavorConflict(null);\n    setToast('طُبّقت تعديلاتك فوق القيم الحالية. راجعها ثم احفظ.', 'success');\n  };\n",
   "    setEditFlavorActive(flavor.status !== 'hidden');\n  };\n"
  ],
  [
   "        isActive: editFlavorActive,\n        expectedUpdatedAt: flavorOpened?.version || flavor.updatedAt,\n      });\n",
   "        isActive: editFlavorActive,\n      });\n"
  ],
  [
   "          await removeUploadedProductImage(uploadedStoragePath);\n        }\n        if (result.errorDetails?.code === 'PRODUCT_EDIT_CONFLICT' && result.conflict) {\n          setFlavorConflict(result.conflict);\n          setToast(result.error || 'عدّل مستخدم آخر هذا المنتج قبل قليل.', 'error');\n          return;\n        }\n",
   "          await removeUploadedProductImage(uploadedStoragePath);\n        }\n"
  ],
  [
   "\n                        {flavorConflict && (\n                          <ProductEditConflictPanel\n                            rows={flavorConflictRows()}\n                            statusChange={\n                              flavorOpened && flavorConflict.isActive !== flavorOpened.active\n                                ? { mine: editFlavorActive, current: flavorConflict.isActive }\n                                : undefined\n                            }\n                            formatValue={(_row, value) => (value === '' || value == null ? '—' : String(value))}\n                            onReapply={reapplyFlavorEdits}\n                          />\n                        )}\n\n                        <div className=\"grid grid-cols-2 gap-2\">\n",
   "\n                        <div className=\"grid grid-cols-2 gap-2\">\n"
  ]
 ],
 "src/stores/useAppStore.ts": [
  [
   "\n  /**\n   * Versioned save (migration 170): expectedUpdatedAt is the products.updated_at\n   * the editor opened. Without it the store's copy is used (quick actions).\n   */\n  public async updateProduct(\n    id: string,\n    updates: Partial<Product>,\n    options: { expectedUpdatedAt?: string } = {}\n  ) {\n    const prodIndex = this.state.products.findIndex((p) => p.id === id);\n",
   "\n  public async updateProduct(id: string, updates: Partial<Product>) {\n    const prodIndex = this.state.products.findIndex((p) => p.id === id);\n"
  ],
  [
   "      imageUrl: updates.imageUrl ?? current.imageUrl,\n      expectedUpdatedAt: options.expectedUpdatedAt ?? current.updatedAt,\n    });\n",
   "      imageUrl: updates.imageUrl ?? current.imageUrl,\n    });\n"
  ],
  [
   "      this.setToast(result.error || 'فشل تحديث المنتج في Supabase.', 'error');\n      if (result.errorDetails?.code === 'PRODUCT_EDIT_CONFLICT') {\n        // Show the other user's values everywhere; the next save starts from them.\n        await this.refreshProductsFromSupabase();\n      }\n      return result;\n",
   "      this.setToast(result.error || 'فشل تحديث المنتج في Supabase.', 'error');\n      return result;\n"
  ],
  [
   "    addProduct: (data: Partial<Product>) => storeEngine.addProduct(data),\n    updateProduct: (id: string, updates: Partial<Product>, options?: { expectedUpdatedAt?: string }) =>\n      storeEngine.updateProduct(id, updates, options),\n    deleteProduct: (id: string) => storeEngine.deleteProduct(id),\n",
   "    addProduct: (data: Partial<Product>) => storeEngine.addProduct(data),\n    updateProduct: (id: string, updates: Partial<Product>) => storeEngine.updateProduct(id, updates),\n    deleteProduct: (id: string) => storeEngine.deleteProduct(id),\n"
  ]
 ]
};
export function approvedProductEditConflictSource(file:string,source:string):string {
  const hunks=Object.entries(productEditConflictHunks).find(([path])=>file.endsWith(path))?.[1];
  if(!hunks)return source;
  let result=source.replaceAll('\r\n','\n');
  for(const [approved,original] of hunks){
    if(result.split(approved).length!==2)throw new Error(`UNAPPROVED_PRODUCT_EDIT_CHANGE:${file}`);
    result=result.replace(approved,()=>original);
  }
  return result;
}
