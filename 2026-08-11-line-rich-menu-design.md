# LINE Rich Menu Design: Smart Groupinsights

## Goal

Create a production-ready LINE Rich Menu image for a hospital HOSxP reporting workflow. The menu must be legible on mobile, professional, and consistent with the attached Smart Groupinsights dashboard reference.

## Canvas and layout

- Canvas: 2500 × 1686 px (LINE large Rich Menu)
- Grid: 3 columns × 2 rows with six equal touch areas
- Visual hierarchy: large icon, short Thai label, one-line hint, clear separation between tiles
- No header band: card edges must match the touch areas in `scripts/line-rich-menu-config.json` (rows split at y=843, columns at x=833/1667)
- Safe margins: keep essential text and icons away from tile edges

## Menu items

Top row:

1. นำเข้าข้อมูล
2. ดูรายงาน
3. ตรวจสอบลูกหนี้

Bottom row:

4. Authen Code
5. คู่มือใช้งาน
6. ติดต่อผู้ดูแล

## Source

The image is generated, not hand-drawn: edit `scripts/line-rich-menu/rich-menu.html`, then run `npm run line:richmenu:render` (writes the PNG and a <1MB JPG; the render fails if any label overflows its card) and `npm run line:richmenu` to upload.

## Visual direction

- Deep navy background with a faint grid; glass cards with a soft colored glow
- One accent color per action (blue, violet, amber, emerald, teal, rose) on the icon tile
- White line icons with strong contrast
- Thai sans-serif typography, bold and highly legible
- No unnecessary body copy or decorative clutter

## Deliverable

- One PNG at exactly 2500 × 1686 px
- No phone screenshot frame or LINE chat UI in the final asset
- The six tile boundaries must align with LINE touch areas

## Acceptance checks

- Exact dimensions and PNG format
- All six labels spelled correctly
- Readable at mobile display size
- Six balanced touch targets
- No clipped text, icons, or brand name
