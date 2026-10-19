/**
 * Librería Grafito (`src/ui/`). Clases con prefijo `ui-`, colores y medidas
 * solo de tokens (docs/redesign/TOKENS.md). Nada flota: listas, calendarios,
 * confirmaciones y avisos van en línea; la única capa es el tooltip del texto
 * truncado.
 *
 * Lo pesado (pickers, FileDrop, ColorField) se exporta desde `./lazy` y viaja
 * en un chunk aparte que baja la primera vez que se dibuja.
 */

// Acciones
export { Button, IconButton, Kbd, type ButtonProps, type ButtonVariant, type ButtonSize, type IconButtonProps } from './Button';
export { Spinner } from './icons';
export * as icons from './icons';

// Campos
export { FieldShell, Input, Textarea, NumberField, useFieldIds, type FieldProps, type InputProps, type TextareaProps, type NumberFieldProps } from './Field';
export { Checkbox, Switch, RadioGroup, Segmented, type CheckboxProps, type SwitchProps, type RadioGroupProps, type SegmentedProps, type ChoiceOption } from './Toggle';
export { Select, SelectField, Combobox, type SelectOption, type SelectProps, type ComboboxProps } from './Select';
export { TagInput, type TagInputProps } from './TagInput';

// Diferidos (chunk `pickers`)
export { DatePicker, DateField, DateRange, TimeField, DateTimeField, ColorField, FileDrop, preloadPickers } from './lazy';
export type { DatePickerProps, DateRangeProps, DateRangeValue, DateRangePreset, DateShortcut } from './pickers/DatePicker';
export type { TimeFieldProps, DateTimeFieldProps } from './pickers/TimeField';
export type { ColorFieldProps } from './pickers/ColorField';
export type { FileDropProps, FileDropItem, FileDropStatus } from './pickers/FileDrop';

// Patrones en línea
export {
  Disclosure, InlineConfirm, useInlineConfirm, InlinePrompt, useInlinePrompt,
  StatusLine, useStatusLine, StatusOutlet, pushStatus, clearStatus, SelectionHeader,
  type DisclosureProps, type InlineConfirmProps, type StatusLineProps, type StatusMessage, type StatusTone, type SelectionHeaderProps
} from './Inline';
export { useSelection, type Selection } from './selection';

// Abrir y cerrar sin saltos (toda sección, grupo, ficha o panel que se despliega)
export {
  Collapse, keepInPlace, useAnchoredToggle, useHeldKeys, revealInView, scrollParentOf, recentTrigger, releaseScrollReserve, COLLAPSE_MS,
  type CollapseProps, type KeepInPlace, type KeepInPlaceOptions
} from './Collapse';
export { useScrollEdges } from './scrollEdges';
export { StatusSlot } from './StatusSlot';

// Datos y estados
export { StatusText, ageTone, Ring, ringTone, Skeleton, SkeletonText, SkeletonRows, EmptyState, ErrorState, Eyebrow, SectionHeader, type StatusTextTone, type RingProps } from './Data';
export { Table, type Column, type TableProps, type TableSelection, type SortState, type SortDir } from './Table';
export { Tabs, type TabItem, type TabsProps } from './Tabs';
export { TruncatedText, Tooltip, type TruncatedTextProps } from './Truncated';

export { cx } from './util';
