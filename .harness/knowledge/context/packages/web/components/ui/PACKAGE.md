---
governs: packages/web/src/components/ui/
last_verified_sha: ad0153a
key_files: [button.tsx, input.tsx, dialog.tsx, table.tsx, badge.tsx, card.tsx, label.tsx, select.tsx, separator.tsx, sonner.tsx, switch.tsx, tabs.tsx]
flow_fns: []
decisions: []
status: active
---

# components/ui/ — shadcn base components (thin Radix wrappers)

## Purpose

Thin wrappers around Radix UI primitives with Tailwind styling. These are the design system atoms used by all other components. Each file typically exports a single component using `class-variance-authority` for variants.

## Public surface

All components are standard shadcn patterns. Key ones:

| Component | Base |
|---|---|
| `Button({ variant, size, asChild, ... })` | `@radix-ui/react-slot` + `class-variance-authority` variants: default, destructive, outline, secondary, ghost, link; sizes: default, sm, lg, icon |
| `Input` | Styled `<input>` with focus ring |
| `Dialog`, `DialogContent`, `DialogTitle`, `DialogDescription`, `DialogHeader`, `DialogFooter` | `@radix-ui/react-dialog` |
| `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell` | Plain styled HTML table elements |
| `Badge({ variant, ... })` | Inline span with secondary/destructive/outline variants |
| `Card`, `CardHeader`, `CardTitle`, `CardContent` | Styled div containers |
| `Select`, `SelectTrigger`, `SelectContent`, `SelectItem` | `@radix-ui/react-select` |
| `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` | `@radix-ui/react-tabs` |
| `Switch` | `@radix-ui/react-switch` |
| `Separator` | `@radix-ui/react-separator` |
| `Label` | `@radix-ui/react-label` |
| `Toaster` / `sonner.tsx` | `sonner` toast notification wrapper |

## Depends on / used by

- **Uses:** `@radix-ui/*`, `class-variance-authority`, `clsx`, `tailwind-merge`, `sonner`, `react-hook-form`
- **Used by:** every other component in the app
