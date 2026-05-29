import * as React from 'react'
import { createRoot } from 'react-dom/client'

import { Button } from '../../src/components/ui/button'
import { Calendar } from '../../src/components/ui/calendar'
import {
  Combobox,
  ComboboxContent,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from '../../src/components/ui/combobox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../src/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../../src/components/ui/dropdown-menu'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
} from '../../src/components/ui/field'
import { Input } from '../../src/components/ui/input'
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarShortcut,
  MenubarTrigger,
} from '../../src/components/ui/menubar'
import {
  NativeSelect,
  NativeSelectOption,
} from '../../src/components/ui/native-select'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../src/components/ui/select'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '../../src/components/ui/sidebar'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../src/components/ui/table'
import { Textarea } from '../../src/components/ui/textarea'

export function TypographyPrimitiveFixture() {
  const selectedDate = new Date(2026, 4, 14)
  const buttonLinkRef = React.useRef<HTMLAnchorElement | null>(null)
  const [asChildState, setAsChildState] = React.useState({
    childClicks: 0,
    refReady: false,
    slotClicks: 0,
  })
  const [dialogOpen, setDialogOpen] = React.useState(false)

  React.useLayoutEffect(() => {
    setAsChildState((current) => ({
      ...current,
      refReady: buttonLinkRef.current?.getAttribute('data-slot') === 'button',
    }))
  }, [])

  return (
    <main>
      <Button
        asChild
        className="text-background"
        onClick={(event) => {
          event.preventDefault()
          setDialogOpen(true)
          setAsChildState((current) => ({
            ...current,
            slotClicks: current.slotClicks + 1,
          }))
        }}
      >
        <a
          ref={buttonLinkRef}
          data-testid="button-link"
          href="/settings"
          onClick={() => {
            setAsChildState((current) => ({
              ...current,
              childClicks: current.childClicks + 1,
            }))
          }}
        >
          Settings
        </a>
      </Button>
      <output
        data-slot="aschild-state"
        data-testid="aschild-state"
        data-child-clicks={asChildState.childClicks}
        data-ref-ready={asChildState.refReady}
        data-slot-clicks={asChildState.slotClicks}
      />

      <Dialog open={dialogOpen}>
        <DialogContent showCloseButton={false}>
          <DialogTitle data-testid="dialog-title">Dialog title</DialogTitle>
          <DialogDescription data-testid="dialog-description">
            Dialog description
          </DialogDescription>
        </DialogContent>
      </Dialog>

      <DropdownMenu open>
        <DropdownMenuContent>
          <DropdownMenuItem data-testid="dropdown-item">
            Menu item
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Select open value="alpha">
        <SelectTrigger data-testid="select-trigger">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem data-testid="select-item" value="alpha">
            Alpha
          </SelectItem>
        </SelectContent>
      </Select>

      <Calendar
        mode="single"
        month={new Date(2026, 4, 1)}
        selected={selectedDate}
      />

      <Menubar value="file">
        <MenubarMenu value="file">
          <MenubarTrigger data-testid="menubar-trigger">File</MenubarTrigger>
          <MenubarContent>
            <MenubarLabel data-testid="menubar-label">Actions</MenubarLabel>
            <MenubarItem data-testid="menubar-item">
              New file
              <MenubarShortcut data-testid="menubar-shortcut">
                N
              </MenubarShortcut>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>

      <Combobox
        defaultValue="alpha"
        items={['alpha', 'beta']}
        itemToStringLabel={(item) => item}
        open
      >
        <ComboboxInput data-testid="combobox-input" placeholder="Search" />
        <ComboboxContent>
          <ComboboxList>
            <ComboboxGroup>
              <ComboboxLabel data-testid="combobox-label">
                Products
              </ComboboxLabel>
              <ComboboxItem data-testid="combobox-item" value="alpha">
                Alpha option
              </ComboboxItem>
            </ComboboxGroup>
          </ComboboxList>
        </ComboboxContent>
      </Combobox>

      <FieldSet>
        <FieldLegend data-testid="field-legend">Profile</FieldLegend>
        <FieldGroup>
          <Field data-invalid="true">
            <FieldLabel data-testid="field-label" htmlFor="fixture-name">
              Name
            </FieldLabel>
            <Input
              aria-invalid="true"
              data-testid="input-control"
              id="fixture-name"
              defaultValue="Ada"
            />
            <FieldDescription data-testid="field-description">
              Public display name
            </FieldDescription>
            <FieldError
              data-testid="field-error"
              errors={[{ message: 'Name is required' }]}
            />
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle data-testid="field-title">Notifications</FieldTitle>
              <FieldDescription>Receive account updates</FieldDescription>
            </FieldContent>
          </Field>
        </FieldGroup>
        <FieldSeparator>or</FieldSeparator>
      </FieldSet>

      <Textarea data-testid="textarea-control" defaultValue="Longer note" />
      <NativeSelect data-testid="native-select" defaultValue="alpha">
        <NativeSelectOption value="alpha">Alpha</NativeSelectOption>
        <NativeSelectOption value="beta">Beta</NativeSelectOption>
      </NativeSelect>

      <Table data-testid="data-table">
        <TableCaption data-testid="table-caption">Recent items</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead data-testid="table-head">Name</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell data-testid="table-cell">Alpha row</TableCell>
          </TableRow>
        </TableBody>
      </Table>

      <SidebarProvider>
        <Sidebar collapsible="none">
          <SidebarHeader>
            <SidebarGroup>
              <SidebarGroupLabel data-testid="sidebar-group-label">
                Workspace
              </SidebarGroupLabel>
              <SidebarGroupContent data-testid="sidebar-group-content">
                <SidebarContent>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        asChild
                        data-testid="sidebar-menu-button"
                        isActive
                      >
                        <a href="/dashboard">
                          <span>Dashboard</span>
                        </a>
                      </SidebarMenuButton>
                      <SidebarMenuBadge data-testid="sidebar-menu-badge">
                        7
                      </SidebarMenuBadge>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarContent>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarHeader>
        </Sidebar>
      </SidebarProvider>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<TypographyPrimitiveFixture />)
requestAnimationFrame(() => {
  document.body.dataset.ready = 'true'
})
