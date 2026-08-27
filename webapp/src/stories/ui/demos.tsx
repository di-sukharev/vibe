import { useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
} from 'recharts'
import { toast } from 'sonner'

import * as AccordionUi from '@/components/ui/accordion'
import * as AttachmentUi from '@/components/ui/attachment'
import * as AlertDialogUi from '@/components/ui/alert-dialog'
import * as AlertUi from '@/components/ui/alert'
import * as AspectRatioUi from '@/components/ui/aspect-ratio'
import * as AvatarUi from '@/components/ui/avatar'
import * as BadgeUi from '@/components/ui/badge'
import * as BubbleUi from '@/components/ui/bubble'
import * as BreadcrumbUi from '@/components/ui/breadcrumb'
import * as ButtonGroupUi from '@/components/ui/button-group'
import * as ButtonUi from '@/components/ui/button'
import * as CalendarUi from '@/components/ui/calendar'
import * as CardUi from '@/components/ui/card'
import * as CarouselUi from '@/components/ui/carousel'
import * as ChartUi from '@/components/ui/chart'
import * as CheckboxUi from '@/components/ui/checkbox'
import * as CollapsibleUi from '@/components/ui/collapsible'
import * as ComboboxUi from '@/components/ui/combobox'
import * as CommandUi from '@/components/ui/command'
import * as ContextMenuUi from '@/components/ui/context-menu'
import * as DialogUi from '@/components/ui/dialog'
import * as DirectionUi from '@/components/ui/direction'
import * as DrawerUi from '@/components/ui/drawer'
import * as DropdownMenuUi from '@/components/ui/dropdown-menu'
import * as EmptyUi from '@/components/ui/empty'
import * as FieldUi from '@/components/ui/field'
import * as HoverCardUi from '@/components/ui/hover-card'
import * as InputGroupUi from '@/components/ui/input-group'
import * as InputOtpUi from '@/components/ui/input-otp'
import * as InputUi from '@/components/ui/input'
import * as ItemUi from '@/components/ui/item'
import * as KbdUi from '@/components/ui/kbd'
import * as LabelUi from '@/components/ui/label'
import * as MenubarUi from '@/components/ui/menubar'
import * as MarkerUi from '@/components/ui/marker'
import * as MessageScrollerUi from '@/components/ui/message-scroller'
import * as MessageUi from '@/components/ui/message'
import * as NativeSelectUi from '@/components/ui/native-select'
import * as NavigationMenuUi from '@/components/ui/navigation-menu'
import * as PaginationUi from '@/components/ui/pagination'
import * as PopoverUi from '@/components/ui/popover'
import * as ProgressUi from '@/components/ui/progress'
import * as RadioGroupUi from '@/components/ui/radio-group'
import * as ResizableUi from '@/components/ui/resizable'
import * as ScrollAreaUi from '@/components/ui/scroll-area'
import * as SelectUi from '@/components/ui/select'
import * as SeparatorUi from '@/components/ui/separator'
import * as SheetUi from '@/components/ui/sheet'
import * as SidebarUi from '@/components/ui/sidebar'
import * as SkeletonUi from '@/components/ui/skeleton'
import * as SliderUi from '@/components/ui/slider'
import * as SonnerUi from '@/components/ui/sonner'
import * as SpinnerUi from '@/components/ui/spinner'
import * as SwitchUi from '@/components/ui/switch'
import * as TableUi from '@/components/ui/table'
import * as TabsUi from '@/components/ui/tabs'
import * as TextareaUi from '@/components/ui/textarea'
import * as ToggleGroupUi from '@/components/ui/toggle-group'
import * as ToggleUi from '@/components/ui/toggle'
import * as TooltipUi from '@/components/ui/tooltip'

const options = ['Design', 'Engineering', 'Product']
const chartData = [
  { month: 'Jan', total: 18 },
  { month: 'Feb', total: 31 },
  { month: 'Mar', total: 24 },
  { month: 'Apr', total: 42 },
]

function DemoSurface({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-2xl p-6">{children}</div>
}

function AccordionDemo() {
  return (
    <DemoSurface>
      <AccordionUi.Accordion defaultValue="first" type="single" collapsible>
        <AccordionUi.AccordionItem value="first">
          <AccordionUi.AccordionTrigger>What is included?</AccordionUi.AccordionTrigger>
          <AccordionUi.AccordionContent>All core UI states and responsive behavior.</AccordionUi.AccordionContent>
        </AccordionUi.AccordionItem>
        <AccordionUi.AccordionItem value="second">
          <AccordionUi.AccordionTrigger>Can it be customized?</AccordionUi.AccordionTrigger>
          <AccordionUi.AccordionContent>Yes. Components use local design tokens.</AccordionUi.AccordionContent>
        </AccordionUi.AccordionItem>
      </AccordionUi.Accordion>
    </DemoSurface>
  )
}

function AlertDemo() {
  return (
    <DemoSurface>
      <div className="grid gap-4">
        <AlertUi.Alert>
          <AlertUi.AlertTitle>Changes saved</AlertUi.AlertTitle>
          <AlertUi.AlertDescription>Your workspace is up to date.</AlertUi.AlertDescription>
        </AlertUi.Alert>
        <AlertUi.Alert variant="destructive">
          <AlertUi.AlertTitle>Could not save</AlertUi.AlertTitle>
          <AlertUi.AlertDescription>Check the connection and try again.</AlertUi.AlertDescription>
        </AlertUi.Alert>
      </div>
    </DemoSurface>
  )
}

function AlertDialogDemo({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <DemoSurface>
      <AlertDialogUi.AlertDialog defaultOpen={defaultOpen}>
        <AlertDialogUi.AlertDialogTrigger asChild>
          <ButtonUi.Button variant="destructive">Delete project</ButtonUi.Button>
        </AlertDialogUi.AlertDialogTrigger>
        <AlertDialogUi.AlertDialogContent>
          <AlertDialogUi.AlertDialogHeader>
            <AlertDialogUi.AlertDialogTitle>Delete this project?</AlertDialogUi.AlertDialogTitle>
            <AlertDialogUi.AlertDialogDescription>This action cannot be undone.</AlertDialogUi.AlertDialogDescription>
          </AlertDialogUi.AlertDialogHeader>
          <AlertDialogUi.AlertDialogFooter>
            <AlertDialogUi.AlertDialogCancel>Cancel</AlertDialogUi.AlertDialogCancel>
            <AlertDialogUi.AlertDialogAction variant="destructive">Delete</AlertDialogUi.AlertDialogAction>
          </AlertDialogUi.AlertDialogFooter>
        </AlertDialogUi.AlertDialogContent>
      </AlertDialogUi.AlertDialog>
    </DemoSurface>
  )
}

function AspectRatioDemo() {
  return (
    <DemoSurface>
      <AspectRatioUi.AspectRatio className="overflow-hidden rounded-xl border bg-muted" ratio={16 / 9}>
        <div className="grid size-full place-items-center text-sm text-foreground">16:9 media</div>
      </AspectRatioUi.AspectRatio>
    </DemoSurface>
  )
}

function AvatarDemo() {
  return (
    <DemoSurface>
      <AvatarUi.AvatarGroup>
        {['DS', 'UI', 'QA'].map((label) => (
          <AvatarUi.Avatar key={label} size="lg">
            <AvatarUi.AvatarFallback>{label}</AvatarUi.AvatarFallback>
          </AvatarUi.Avatar>
        ))}
        <AvatarUi.AvatarGroupCount>+4</AvatarUi.AvatarGroupCount>
      </AvatarUi.AvatarGroup>
    </DemoSurface>
  )
}

function BadgeDemo() {
  return (
    <DemoSurface>
      <div className="flex flex-wrap gap-2">
        {(['default', 'secondary', 'outline', 'destructive', 'ghost', 'link'] as const).map((variant) => (
          <BadgeUi.Badge key={variant} variant={variant}>{variant}</BadgeUi.Badge>
        ))}
      </div>
    </DemoSurface>
  )
}

function BreadcrumbDemo() {
  return (
    <DemoSurface>
      <BreadcrumbUi.Breadcrumb>
        <BreadcrumbUi.BreadcrumbList>
          <BreadcrumbUi.BreadcrumbItem><BreadcrumbUi.BreadcrumbLink href="#">Workspace</BreadcrumbUi.BreadcrumbLink></BreadcrumbUi.BreadcrumbItem>
          <BreadcrumbUi.BreadcrumbSeparator />
          <BreadcrumbUi.BreadcrumbItem><BreadcrumbUi.BreadcrumbEllipsis /></BreadcrumbUi.BreadcrumbItem>
          <BreadcrumbUi.BreadcrumbSeparator />
          <BreadcrumbUi.BreadcrumbItem><BreadcrumbUi.BreadcrumbPage>Settings</BreadcrumbUi.BreadcrumbPage></BreadcrumbUi.BreadcrumbItem>
        </BreadcrumbUi.BreadcrumbList>
      </BreadcrumbUi.Breadcrumb>
    </DemoSurface>
  )
}

function ButtonDemo() {
  return (
    <DemoSurface>
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {(['default', 'secondary', 'outline', 'ghost', 'destructive', 'link'] as const).map((variant) => (
            <ButtonUi.Button key={variant} variant={variant}>{variant}</ButtonUi.Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(['xs', 'sm', 'default', 'lg'] as const).map((size) => (
            <ButtonUi.Button key={size} size={size}>{size}</ButtonUi.Button>
          ))}
          <ButtonUi.Button disabled>Disabled</ButtonUi.Button>
        </div>
      </div>
    </DemoSurface>
  )
}

function ButtonGroupDemo() {
  return (
    <DemoSurface>
      <ButtonGroupUi.ButtonGroup>
        <ButtonUi.Button variant="outline">Previous</ButtonUi.Button>
        <ButtonGroupUi.ButtonGroupText>2 of 8</ButtonGroupUi.ButtonGroupText>
        <ButtonUi.Button variant="outline">Next</ButtonUi.Button>
      </ButtonGroupUi.ButtonGroup>
    </DemoSurface>
  )
}

function CalendarDemo() {
  const [selected, setSelected] = useState<Date | undefined>(new Date(2026, 7, 26))
  return <DemoSurface><CalendarUi.Calendar mode="single" onSelect={setSelected} selected={selected} /></DemoSurface>
}

function CardDemo() {
  return (
    <DemoSurface>
      <CardUi.Card>
        <CardUi.CardHeader>
          <CardUi.CardTitle>Component card</CardUi.CardTitle>
          <CardUi.CardDescription>A reusable surface with consistent spacing.</CardUi.CardDescription>
          <CardUi.CardAction><BadgeUi.Badge variant="secondary">New</BadgeUi.Badge></CardUi.CardAction>
        </CardUi.CardHeader>
        <CardUi.CardContent><p className="text-sm">Content remains readable at every viewport.</p></CardUi.CardContent>
        <CardUi.CardFooter className="border-t"><ButtonUi.Button size="sm">Continue</ButtonUi.Button></CardUi.CardFooter>
      </CardUi.Card>
    </DemoSurface>
  )
}

function CarouselDemo() {
  return (
    <DemoSurface>
      <CarouselUi.Carousel className="mx-auto w-[calc(100%-6rem)]" opts={{ loop: true }}>
        <CarouselUi.CarouselContent>
          {[1, 2, 3].map((item) => (
            <CarouselUi.CarouselItem key={item}>
              <CardUi.Card><CardUi.CardContent className="grid aspect-video place-items-center text-3xl font-semibold">{item}</CardUi.CardContent></CardUi.Card>
            </CarouselUi.CarouselItem>
          ))}
        </CarouselUi.CarouselContent>
        <CarouselUi.CarouselPrevious />
        <CarouselUi.CarouselNext />
      </CarouselUi.Carousel>
    </DemoSurface>
  )
}

function ChartDemo() {
  return (
    <DemoSurface>
      <ChartUi.ChartContainer className="h-64 w-full" config={{ total: { color: 'var(--primary)', label: 'Total' } }}>
        <BarChart data={chartData} accessibilityLayer>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} />
          <ChartUi.ChartTooltip content={<ChartUi.ChartTooltipContent />} />
          <Bar dataKey="total" fill="var(--color-total)" radius={6} />
        </BarChart>
      </ChartUi.ChartContainer>
    </DemoSurface>
  )
}

function CheckboxDemo() {
  return (
    <DemoSurface>
      <div className="grid gap-4">
        <label className="flex items-center gap-3 text-sm"><CheckboxUi.Checkbox defaultChecked />Selected</label>
        <label className="flex items-center gap-3 text-sm"><CheckboxUi.Checkbox />Unselected</label>
        <label className="flex items-center gap-3 text-sm opacity-60"><CheckboxUi.Checkbox disabled />Disabled</label>
        <label className="flex items-center gap-3 text-sm text-destructive"><CheckboxUi.Checkbox aria-invalid />Invalid</label>
      </div>
    </DemoSurface>
  )
}

function CollapsibleDemo() {
  return (
    <DemoSurface>
      <CollapsibleUi.Collapsible className="grid gap-2" defaultOpen>
        <CollapsibleUi.CollapsibleTrigger asChild><ButtonUi.Button variant="outline">Toggle details</ButtonUi.Button></CollapsibleUi.CollapsibleTrigger>
        <CollapsibleUi.CollapsibleContent className="rounded-lg border bg-muted/40 p-4 text-sm">Additional content stays grouped with its trigger.</CollapsibleUi.CollapsibleContent>
      </CollapsibleUi.Collapsible>
    </DemoSurface>
  )
}

function ComboboxDemo() {
  return (
    <DemoSurface>
      <ComboboxUi.Combobox items={options}>
        <ComboboxUi.ComboboxInput className="w-64" placeholder="Choose a team" showClear />
        <ComboboxUi.ComboboxContent>
          <ComboboxUi.ComboboxEmpty>No team found.</ComboboxUi.ComboboxEmpty>
          <ComboboxUi.ComboboxList>
            {options.map((option) => <ComboboxUi.ComboboxItem key={option} value={option}>{option}</ComboboxUi.ComboboxItem>)}
          </ComboboxUi.ComboboxList>
        </ComboboxUi.ComboboxContent>
      </ComboboxUi.Combobox>
    </DemoSurface>
  )
}

function CommandDemo() {
  return (
    <DemoSurface>
      <CommandUi.Command className="rounded-lg border shadow-sm">
        <CommandUi.CommandInput placeholder="Search commands" />
        <CommandUi.CommandList>
          <CommandUi.CommandEmpty>No results.</CommandUi.CommandEmpty>
          <CommandUi.CommandGroup heading="Workspace">
            <CommandUi.CommandItem>Open profile<CommandUi.CommandShortcut>⌘P</CommandUi.CommandShortcut></CommandUi.CommandItem>
            <CommandUi.CommandItem>Open settings<CommandUi.CommandShortcut>⌘S</CommandUi.CommandShortcut></CommandUi.CommandItem>
          </CommandUi.CommandGroup>
        </CommandUi.CommandList>
      </CommandUi.Command>
    </DemoSurface>
  )
}

function ContextMenuDemo() {
  return (
    <DemoSurface>
      <ContextMenuUi.ContextMenu>
        <ContextMenuUi.ContextMenuTrigger className="grid h-40 place-items-center rounded-xl border border-dashed text-sm text-muted-foreground">Right-click this area</ContextMenuUi.ContextMenuTrigger>
        <ContextMenuUi.ContextMenuContent>
          <ContextMenuUi.ContextMenuItem>Open</ContextMenuUi.ContextMenuItem>
          <ContextMenuUi.ContextMenuItem>Duplicate<ContextMenuUi.ContextMenuShortcut>⌘D</ContextMenuUi.ContextMenuShortcut></ContextMenuUi.ContextMenuItem>
          <ContextMenuUi.ContextMenuSeparator />
          <ContextMenuUi.ContextMenuItem variant="destructive">Delete</ContextMenuUi.ContextMenuItem>
        </ContextMenuUi.ContextMenuContent>
      </ContextMenuUi.ContextMenu>
    </DemoSurface>
  )
}

function DialogDemo({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <DemoSurface>
      <DialogUi.Dialog defaultOpen={defaultOpen}>
        <DialogUi.DialogTrigger asChild><ButtonUi.Button>Edit profile</ButtonUi.Button></DialogUi.DialogTrigger>
        <DialogUi.DialogContent>
          <DialogUi.DialogHeader><DialogUi.DialogTitle>Edit profile</DialogUi.DialogTitle><DialogUi.DialogDescription>Update the name shown in your workspace.</DialogUi.DialogDescription></DialogUi.DialogHeader>
          <InputUi.Input defaultValue="Alex Morgan" aria-label="Display name" />
          <DialogUi.DialogFooter><DialogUi.DialogClose asChild><ButtonUi.Button variant="outline">Cancel</ButtonUi.Button></DialogUi.DialogClose><ButtonUi.Button>Save</ButtonUi.Button></DialogUi.DialogFooter>
        </DialogUi.DialogContent>
      </DialogUi.Dialog>
    </DemoSurface>
  )
}

function DirectionDemo() {
  return <DemoSurface><DirectionUi.DirectionProvider dir="rtl"><div dir="rtl" className="rounded-lg border p-4 text-sm">واجهة من اليمين إلى اليسار</div></DirectionUi.DirectionProvider></DemoSurface>
}

function DrawerDemo({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <DemoSurface>
      <DrawerUi.Drawer defaultOpen={defaultOpen}>
        <DrawerUi.DrawerTrigger asChild><ButtonUi.Button variant="outline">Open drawer</ButtonUi.Button></DrawerUi.DrawerTrigger>
        <DrawerUi.DrawerContent>
          <DrawerUi.DrawerHeader><DrawerUi.DrawerTitle>Quick settings</DrawerUi.DrawerTitle><DrawerUi.DrawerDescription>Adjust the current workspace.</DrawerUi.DrawerDescription></DrawerUi.DrawerHeader>
          <DrawerUi.DrawerFooter><DrawerUi.DrawerClose asChild><ButtonUi.Button>Done</ButtonUi.Button></DrawerUi.DrawerClose></DrawerUi.DrawerFooter>
        </DrawerUi.DrawerContent>
      </DrawerUi.Drawer>
    </DemoSurface>
  )
}

function DropdownMenuDemo({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <DemoSurface>
      <DropdownMenuUi.DropdownMenu defaultOpen={defaultOpen}>
        <DropdownMenuUi.DropdownMenuTrigger asChild><ButtonUi.Button className={defaultOpen ? "disabled:opacity-100" : undefined} disabled={defaultOpen} variant="outline">Open menu</ButtonUi.Button></DropdownMenuUi.DropdownMenuTrigger>
        <DropdownMenuUi.DropdownMenuContent>
          <DropdownMenuUi.DropdownMenuLabel>Actions</DropdownMenuUi.DropdownMenuLabel>
          <DropdownMenuUi.DropdownMenuItem>Edit<DropdownMenuUi.DropdownMenuShortcut>⌘E</DropdownMenuUi.DropdownMenuShortcut></DropdownMenuUi.DropdownMenuItem>
          <DropdownMenuUi.DropdownMenuCheckboxItem checked>Notifications</DropdownMenuUi.DropdownMenuCheckboxItem>
          <DropdownMenuUi.DropdownMenuSeparator />
          <DropdownMenuUi.DropdownMenuItem variant="destructive">Delete</DropdownMenuUi.DropdownMenuItem>
        </DropdownMenuUi.DropdownMenuContent>
      </DropdownMenuUi.DropdownMenu>
    </DemoSurface>
  )
}

function EmptyDemo() {
  return (
    <DemoSurface>
      <EmptyUi.Empty className="border">
        <EmptyUi.EmptyHeader><EmptyUi.EmptyMedia variant="icon">∅</EmptyUi.EmptyMedia><EmptyUi.EmptyTitle>No projects yet</EmptyUi.EmptyTitle><EmptyUi.EmptyDescription>Create the first project to start working.</EmptyUi.EmptyDescription></EmptyUi.EmptyHeader>
        <EmptyUi.EmptyContent><ButtonUi.Button>Create project</ButtonUi.Button></EmptyUi.EmptyContent>
      </EmptyUi.Empty>
    </DemoSurface>
  )
}

function FieldDemo() {
  return (
    <DemoSurface>
      <FieldUi.FieldGroup>
        <FieldUi.Field><FieldUi.FieldLabel htmlFor="story-name">Display name</FieldUi.FieldLabel><InputUi.Input id="story-name" placeholder="Your name" /><FieldUi.FieldDescription>Shown to people in your workspace.</FieldUi.FieldDescription></FieldUi.Field>
        <FieldUi.Field data-invalid><FieldUi.FieldLabel htmlFor="story-code">Invite code</FieldUi.FieldLabel><InputUi.Input id="story-code" aria-invalid defaultValue="x" /><FieldUi.FieldError>Use at least four characters.</FieldUi.FieldError></FieldUi.Field>
      </FieldUi.FieldGroup>
    </DemoSurface>
  )
}

function HoverCardDemo({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <DemoSurface>
      <HoverCardUi.HoverCard defaultOpen={defaultOpen}>
        <HoverCardUi.HoverCardTrigger asChild><ButtonUi.Button variant="link">@design-system</ButtonUi.Button></HoverCardUi.HoverCardTrigger>
        <HoverCardUi.HoverCardContent><div className="grid gap-1"><strong>Design system</strong><span className="text-sm text-muted-foreground">Shared components and interaction rules.</span></div></HoverCardUi.HoverCardContent>
      </HoverCardUi.HoverCard>
    </DemoSurface>
  )
}

function InputDemo() {
  return <DemoSurface><div className="grid gap-3"><InputUi.Input aria-label="Default input" placeholder="Default input" /><InputUi.Input aria-invalid aria-label="Invalid input" defaultValue="Invalid value" /><InputUi.Input aria-label="Disabled input" disabled placeholder="Disabled input" /></div></DemoSurface>
}

function InputGroupDemo() {
  return (
    <DemoSurface>
      <InputGroupUi.InputGroup>
        <InputGroupUi.InputGroupAddon><InputGroupUi.InputGroupText>https://</InputGroupUi.InputGroupText></InputGroupUi.InputGroupAddon>
        <InputGroupUi.InputGroupInput aria-label="Project domain" placeholder="project.example" />
        <InputGroupUi.InputGroupAddon align="inline-end"><InputGroupUi.InputGroupButton size="sm">Copy</InputGroupUi.InputGroupButton></InputGroupUi.InputGroupAddon>
      </InputGroupUi.InputGroup>
    </DemoSurface>
  )
}

function InputOtpDemo() {
  return <DemoSurface><InputOtpUi.InputOTP aria-label="Verification code" maxLength={6}><InputOtpUi.InputOTPGroup>{[0, 1, 2].map((index) => <InputOtpUi.InputOTPSlot index={index} key={index} />)}</InputOtpUi.InputOTPGroup><InputOtpUi.InputOTPSeparator /><InputOtpUi.InputOTPGroup>{[3, 4, 5].map((index) => <InputOtpUi.InputOTPSlot index={index} key={index} />)}</InputOtpUi.InputOTPGroup></InputOtpUi.InputOTP></DemoSurface>
}

function ItemDemo() {
  return (
    <DemoSurface>
      <ItemUi.ItemGroup>
        <ItemUi.Item variant="outline"><ItemUi.ItemMedia variant="icon">A</ItemUi.ItemMedia><ItemUi.ItemContent><ItemUi.ItemTitle>Account settings</ItemUi.ItemTitle><ItemUi.ItemDescription>Profile, password, and security.</ItemUi.ItemDescription></ItemUi.ItemContent><ItemUi.ItemActions><ButtonUi.Button size="sm" variant="outline">Open</ButtonUi.Button></ItemUi.ItemActions></ItemUi.Item>
        <ItemUi.ItemSeparator />
        <ItemUi.Item><ItemUi.ItemContent><ItemUi.ItemTitle>Notifications</ItemUi.ItemTitle><ItemUi.ItemDescription>Choose which updates you receive.</ItemUi.ItemDescription></ItemUi.ItemContent><ItemUi.ItemActions><SwitchUi.Switch aria-label="Notifications" defaultChecked /></ItemUi.ItemActions></ItemUi.Item>
      </ItemUi.ItemGroup>
    </DemoSurface>
  )
}

function KbdDemo() {
  return <DemoSurface><div className="flex items-center gap-2 text-sm">Open command palette <KbdUi.KbdGroup><KbdUi.Kbd>⌘</KbdUi.Kbd><KbdUi.Kbd>K</KbdUi.Kbd></KbdUi.KbdGroup></div></DemoSurface>
}

function LabelDemo() {
  return <DemoSurface><div className="grid gap-2"><LabelUi.Label htmlFor="story-email">Email</LabelUi.Label><InputUi.Input id="story-email" type="email" placeholder="name@example.com" /></div></DemoSurface>
}

function MenubarDemo() {
  return (
    <DemoSurface>
      <MenubarUi.Menubar>
        <MenubarUi.MenubarMenu><MenubarUi.MenubarTrigger>File</MenubarUi.MenubarTrigger><MenubarUi.MenubarContent><MenubarUi.MenubarItem>New project<MenubarUi.MenubarShortcut>⌘N</MenubarUi.MenubarShortcut></MenubarUi.MenubarItem><MenubarUi.MenubarSeparator /><MenubarUi.MenubarItem>Archive</MenubarUi.MenubarItem></MenubarUi.MenubarContent></MenubarUi.MenubarMenu>
        <MenubarUi.MenubarMenu><MenubarUi.MenubarTrigger>View</MenubarUi.MenubarTrigger><MenubarUi.MenubarContent><MenubarUi.MenubarCheckboxItem checked>Sidebar</MenubarUi.MenubarCheckboxItem></MenubarUi.MenubarContent></MenubarUi.MenubarMenu>
      </MenubarUi.Menubar>
    </DemoSurface>
  )
}

function NativeSelectDemo() {
  return <DemoSurface><NativeSelectUi.NativeSelect defaultValue="product" aria-label="Team"><NativeSelectUi.NativeSelectOption value="design">Design</NativeSelectUi.NativeSelectOption><NativeSelectUi.NativeSelectOption value="engineering">Engineering</NativeSelectUi.NativeSelectOption><NativeSelectUi.NativeSelectOption value="product">Product</NativeSelectUi.NativeSelectOption></NativeSelectUi.NativeSelect></DemoSurface>
}

function NavigationMenuDemo() {
  return (
    <DemoSurface>
      <NavigationMenuUi.NavigationMenu>
        <NavigationMenuUi.NavigationMenuList>
          <NavigationMenuUi.NavigationMenuItem><NavigationMenuUi.NavigationMenuLink href="#" className={NavigationMenuUi.navigationMenuTriggerStyle()}>Overview</NavigationMenuUi.NavigationMenuLink></NavigationMenuUi.NavigationMenuItem>
          <NavigationMenuUi.NavigationMenuItem><NavigationMenuUi.NavigationMenuTrigger>Resources</NavigationMenuUi.NavigationMenuTrigger><NavigationMenuUi.NavigationMenuContent><div className="grid w-72 gap-2 p-3"><NavigationMenuUi.NavigationMenuLink href="#" className="rounded-md p-3 hover:bg-accent">Documentation</NavigationMenuUi.NavigationMenuLink><NavigationMenuUi.NavigationMenuLink href="#" className="rounded-md p-3 hover:bg-accent">Examples</NavigationMenuUi.NavigationMenuLink></div></NavigationMenuUi.NavigationMenuContent></NavigationMenuUi.NavigationMenuItem>
        </NavigationMenuUi.NavigationMenuList>
      </NavigationMenuUi.NavigationMenu>
    </DemoSurface>
  )
}

function PaginationDemo() {
  return <DemoSurface><PaginationUi.Pagination><PaginationUi.PaginationContent><PaginationUi.PaginationItem><PaginationUi.PaginationPrevious href="#" /></PaginationUi.PaginationItem><PaginationUi.PaginationItem><PaginationUi.PaginationLink href="#" isActive>1</PaginationUi.PaginationLink></PaginationUi.PaginationItem><PaginationUi.PaginationItem><PaginationUi.PaginationLink href="#">2</PaginationUi.PaginationLink></PaginationUi.PaginationItem><PaginationUi.PaginationItem><PaginationUi.PaginationEllipsis /></PaginationUi.PaginationItem><PaginationUi.PaginationItem><PaginationUi.PaginationNext href="#" /></PaginationUi.PaginationItem></PaginationUi.PaginationContent></PaginationUi.Pagination></DemoSurface>
}

function PopoverDemo({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return <DemoSurface><PopoverUi.Popover defaultOpen={defaultOpen}><PopoverUi.PopoverTrigger asChild><ButtonUi.Button variant="outline">Open popover</ButtonUi.Button></PopoverUi.PopoverTrigger><PopoverUi.PopoverContent aria-label="Card dimensions"><PopoverUi.PopoverHeader><PopoverUi.PopoverTitle>Dimensions</PopoverUi.PopoverTitle><PopoverUi.PopoverDescription>Set the preferred card width.</PopoverUi.PopoverDescription></PopoverUi.PopoverHeader><InputUi.Input type="number" defaultValue="320" aria-label="Width" /></PopoverUi.PopoverContent></PopoverUi.Popover></DemoSurface>
}

function ProgressDemo() {
  return <DemoSurface><div className="grid gap-3"><ProgressUi.Progress value={68} aria-label="68 percent complete" /><span className="text-sm text-muted-foreground">68% complete</span></div></DemoSurface>
}

function RadioGroupDemo() {
  return <DemoSurface><RadioGroupUi.RadioGroup defaultValue="system" className="grid gap-3">{['system', 'light', 'dark'].map((value) => <label className="flex items-center gap-3 text-sm capitalize" key={value}><RadioGroupUi.RadioGroupItem value={value} />{value}</label>)}</RadioGroupUi.RadioGroup></DemoSurface>
}

function ResizableDemo() {
  return <DemoSurface><ResizableUi.ResizablePanelGroup className="h-48 overflow-hidden rounded-xl border" orientation="horizontal"><ResizableUi.ResizablePanel defaultSize="35%"><div className="grid size-full place-items-center bg-muted/40 text-sm">Sidebar</div></ResizableUi.ResizablePanel><ResizableUi.ResizableHandle withHandle /><ResizableUi.ResizablePanel><div className="grid size-full place-items-center text-sm">Content</div></ResizableUi.ResizablePanel></ResizableUi.ResizablePanelGroup></DemoSurface>
}

function ScrollAreaDemo() {
  return <DemoSurface><ScrollAreaUi.ScrollArea className="h-48 rounded-xl border"><div className="grid gap-3 p-4">{Array.from({ length: 12 }, (_, index) => <div className="border-b pb-3 text-sm" key={index}>Scrollable item {index + 1}</div>)}</div><ScrollAreaUi.ScrollBar /></ScrollAreaUi.ScrollArea></DemoSurface>
}

function SelectDemo({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return <DemoSurface><SelectUi.Select defaultOpen={defaultOpen} defaultValue="product"><SelectUi.SelectTrigger aria-label="Team" className="w-64" tabIndex={defaultOpen ? -1 : undefined}><SelectUi.SelectValue placeholder="Choose a team" /></SelectUi.SelectTrigger><SelectUi.SelectContent><SelectUi.SelectGroup><SelectUi.SelectLabel>Teams</SelectUi.SelectLabel>{options.map((option) => <SelectUi.SelectItem key={option} value={option.toLowerCase()}>{option}</SelectUi.SelectItem>)}</SelectUi.SelectGroup></SelectUi.SelectContent></SelectUi.Select></DemoSurface>
}

function SeparatorDemo() {
  return <DemoSurface><div className="grid gap-4"><div><strong>Design system</strong><p className="text-sm text-muted-foreground">A consistent component language.</p></div><SeparatorUi.Separator /><div className="flex h-5 items-center gap-4 text-sm"><span>Overview</span><SeparatorUi.Separator orientation="vertical" /><span>Components</span><SeparatorUi.Separator orientation="vertical" /><span>Patterns</span></div></div></DemoSurface>
}

function SheetDemo({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return <DemoSurface><SheetUi.Sheet defaultOpen={defaultOpen}><SheetUi.SheetTrigger asChild><ButtonUi.Button variant="outline">Open sheet</ButtonUi.Button></SheetUi.SheetTrigger><SheetUi.SheetContent><SheetUi.SheetHeader><SheetUi.SheetTitle>Workspace settings</SheetUi.SheetTitle><SheetUi.SheetDescription>Manage preferences without leaving the page.</SheetUi.SheetDescription></SheetUi.SheetHeader><div className="grid gap-2 px-4"><LabelUi.Label htmlFor="sheet-name">Name</LabelUi.Label><InputUi.Input id="sheet-name" defaultValue="Design team" /></div><SheetUi.SheetFooter><SheetUi.SheetClose asChild><ButtonUi.Button>Save</ButtonUi.Button></SheetUi.SheetClose></SheetUi.SheetFooter></SheetUi.SheetContent></SheetUi.Sheet></DemoSurface>
}

function SidebarDemo() {
  return (
    <div className="h-[34rem] overflow-hidden rounded-xl border">
      <SidebarUi.SidebarProvider defaultOpen>
        <SidebarUi.Sidebar collapsible="icon" variant="inset">
          <SidebarUi.SidebarHeader><SidebarUi.SidebarInput placeholder="Search" /></SidebarUi.SidebarHeader>
          <SidebarUi.SidebarContent><SidebarUi.SidebarGroup><SidebarUi.SidebarGroupLabel>Workspace</SidebarUi.SidebarGroupLabel><SidebarUi.SidebarGroupContent><SidebarUi.SidebarMenu>{['Overview', 'Projects', 'Settings'].map((label, index) => <SidebarUi.SidebarMenuItem key={label}><SidebarUi.SidebarMenuButton isActive={index === 0}><span>{label.slice(0, 1)}</span><span>{label}</span></SidebarUi.SidebarMenuButton></SidebarUi.SidebarMenuItem>)}</SidebarUi.SidebarMenu></SidebarUi.SidebarGroupContent></SidebarUi.SidebarGroup></SidebarUi.SidebarContent>
          <SidebarUi.SidebarFooter><span className="px-2 text-xs text-muted-foreground">Storybook user</span></SidebarUi.SidebarFooter>
          <SidebarUi.SidebarRail />
        </SidebarUi.Sidebar>
        <SidebarUi.SidebarInset><header className="flex h-14 items-center gap-3 border-b px-4"><SidebarUi.SidebarTrigger /><strong>Overview</strong></header><div className="p-6 text-sm text-muted-foreground">Resize the viewport to inspect desktop and mobile behavior.</div></SidebarUi.SidebarInset>
      </SidebarUi.SidebarProvider>
    </div>
  )
}

function SkeletonDemo() {
  return <DemoSurface><div className="flex items-center gap-4"><SkeletonUi.Skeleton className="size-12 rounded-full" /><div className="grid flex-1 gap-2"><SkeletonUi.Skeleton className="h-4 w-2/5" /><SkeletonUi.Skeleton className="h-4 w-4/5" /></div></div></DemoSurface>
}

function SliderDemo() {
  return <DemoSurface><SliderUi.Slider defaultValue={[25, 75]} max={100} step={1} aria-label="Range" /></DemoSurface>
}

function SonnerDemo() {
  return <DemoSurface><ButtonUi.Button onClick={() => toast.success('Changes saved')}>Show toast</ButtonUi.Button><SonnerUi.Toaster /></DemoSurface>
}

function SpinnerDemo() {
  return <DemoSurface><div className="flex items-center gap-3 text-sm"><SpinnerUi.Spinner />Loading workspace…</div></DemoSurface>
}

function SwitchDemo() {
  return <DemoSurface><div className="grid gap-4"><label className="flex items-center gap-3 text-sm"><SwitchUi.Switch defaultChecked />Notifications</label><label className="flex items-center gap-3 text-sm"><SwitchUi.Switch size="sm" />Compact control</label><label className="flex items-center gap-3 text-sm opacity-60"><SwitchUi.Switch disabled />Disabled</label></div></DemoSurface>
}

function TableDemo() {
  return <DemoSurface><TableUi.Table><TableUi.TableCaption>Recent projects</TableUi.TableCaption><TableUi.TableHeader><TableUi.TableRow><TableUi.TableHead>Project</TableUi.TableHead><TableUi.TableHead>Status</TableUi.TableHead><TableUi.TableHead className="text-right">Members</TableUi.TableHead></TableUi.TableRow></TableUi.TableHeader><TableUi.TableBody>{[['Website', 'Active', '6'], ['Mobile app', 'Draft', '3'], ['Research', 'Paused', '2']].map((row) => <TableUi.TableRow key={row[0]}><TableUi.TableCell className="font-medium">{row[0]}</TableUi.TableCell><TableUi.TableCell><BadgeUi.Badge variant="outline">{row[1]}</BadgeUi.Badge></TableUi.TableCell><TableUi.TableCell className="text-right">{row[2]}</TableUi.TableCell></TableUi.TableRow>)}</TableUi.TableBody></TableUi.Table></DemoSurface>
}

function TabsDemo() {
  return <DemoSurface><TabsUi.Tabs defaultValue="overview"><TabsUi.TabsList><TabsUi.TabsTrigger value="overview">Overview</TabsUi.TabsTrigger><TabsUi.TabsTrigger value="activity">Activity</TabsUi.TabsTrigger><TabsUi.TabsTrigger value="settings" disabled>Settings</TabsUi.TabsTrigger></TabsUi.TabsList><TabsUi.TabsContent className="rounded-lg border p-4" value="overview">Overview content</TabsUi.TabsContent><TabsUi.TabsContent className="rounded-lg border p-4" value="activity">Activity content</TabsUi.TabsContent></TabsUi.Tabs></DemoSurface>
}

function TextareaDemo() {
  return <DemoSurface><div className="grid gap-3"><TextareaUi.Textarea aria-label="Description" placeholder="Write a short description" /><TextareaUi.Textarea aria-invalid aria-label="Invalid description" defaultValue="Invalid content" /><TextareaUi.Textarea aria-label="Disabled description" disabled placeholder="Disabled" /></div></DemoSurface>
}

function ToggleDemo() {
  return <DemoSurface><div className="flex gap-2"><ToggleUi.Toggle aria-label="Toggle bold">Bold</ToggleUi.Toggle><ToggleUi.Toggle aria-label="Toggle italic" variant="outline" defaultPressed>Italic</ToggleUi.Toggle><ToggleUi.Toggle aria-label="Disabled toggle" disabled>Disabled</ToggleUi.Toggle></div></DemoSurface>
}

function ToggleGroupDemo() {
  return <DemoSurface><ToggleGroupUi.ToggleGroup type="multiple" variant="outline" spacing={0} defaultValue={['left']}><ToggleGroupUi.ToggleGroupItem value="left">Left</ToggleGroupUi.ToggleGroupItem><ToggleGroupUi.ToggleGroupItem value="center">Center</ToggleGroupUi.ToggleGroupItem><ToggleGroupUi.ToggleGroupItem value="right">Right</ToggleGroupUi.ToggleGroupItem></ToggleGroupUi.ToggleGroup></DemoSurface>
}

function TooltipDemo({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return <DemoSurface><TooltipUi.Tooltip defaultOpen={defaultOpen}><TooltipUi.TooltipTrigger asChild><ButtonUi.Button variant="outline">Hover or focus</ButtonUi.Button></TooltipUi.TooltipTrigger><TooltipUi.TooltipContent>Keyboard shortcut: ⌘K</TooltipUi.TooltipContent></TooltipUi.Tooltip></DemoSurface>
}

function AttachmentDemo() {
  return (
    <DemoSurface>
      <AttachmentUi.AttachmentGroup>
        <AttachmentUi.Attachment>
          <AttachmentUi.AttachmentMedia>PDF</AttachmentUi.AttachmentMedia>
          <AttachmentUi.AttachmentContent><AttachmentUi.AttachmentTitle>product-brief.pdf</AttachmentUi.AttachmentTitle><AttachmentUi.AttachmentDescription>1.8 MB · ready</AttachmentUi.AttachmentDescription></AttachmentUi.AttachmentContent>
          <AttachmentUi.AttachmentActions><AttachmentUi.AttachmentAction aria-label="Remove attachment">×</AttachmentUi.AttachmentAction></AttachmentUi.AttachmentActions>
        </AttachmentUi.Attachment>
        <AttachmentUi.Attachment state="uploading">
          <AttachmentUi.AttachmentMedia><SpinnerUi.Spinner /></AttachmentUi.AttachmentMedia>
          <AttachmentUi.AttachmentContent><AttachmentUi.AttachmentTitle>research.png</AttachmentUi.AttachmentTitle><AttachmentUi.AttachmentDescription>Uploading…</AttachmentUi.AttachmentDescription></AttachmentUi.AttachmentContent>
        </AttachmentUi.Attachment>
        <AttachmentUi.Attachment state="error">
          <AttachmentUi.AttachmentMedia>!</AttachmentUi.AttachmentMedia>
          <AttachmentUi.AttachmentContent><AttachmentUi.AttachmentTitle>archive.zip</AttachmentUi.AttachmentTitle><AttachmentUi.AttachmentDescription>Upload failed</AttachmentUi.AttachmentDescription></AttachmentUi.AttachmentContent>
        </AttachmentUi.Attachment>
      </AttachmentUi.AttachmentGroup>
    </DemoSurface>
  )
}

function BubbleDemo() {
  return (
    <DemoSurface>
      <BubbleUi.BubbleGroup>
        <BubbleUi.Bubble variant="muted"><BubbleUi.BubbleContent>How should this component behave on mobile?</BubbleUi.BubbleContent></BubbleUi.Bubble>
        <BubbleUi.Bubble align="end"><BubbleUi.BubbleContent>Keep the controls reachable and let long text wrap.</BubbleUi.BubbleContent><BubbleUi.BubbleReactions>👍 3</BubbleUi.BubbleReactions></BubbleUi.Bubble>
        <BubbleUi.Bubble variant="destructive"><BubbleUi.BubbleContent>The message could not be sent.</BubbleUi.BubbleContent></BubbleUi.Bubble>
      </BubbleUi.BubbleGroup>
    </DemoSurface>
  )
}

function MarkerDemo() {
  return (
    <DemoSurface>
      <div className="grid gap-5">
        <MarkerUi.Marker><MarkerUi.MarkerIcon>●</MarkerUi.MarkerIcon><MarkerUi.MarkerContent>Today</MarkerUi.MarkerContent></MarkerUi.Marker>
        <MarkerUi.Marker variant="separator"><MarkerUi.MarkerContent>3 unread messages</MarkerUi.MarkerContent></MarkerUi.Marker>
        <MarkerUi.Marker variant="border"><MarkerUi.MarkerContent>Latest activity</MarkerUi.MarkerContent></MarkerUi.Marker>
      </div>
    </DemoSurface>
  )
}

function MessageDemo() {
  return (
    <DemoSurface>
      <MessageUi.MessageGroup>
        <MessageUi.Message>
          <MessageUi.MessageAvatar>AI</MessageUi.MessageAvatar>
          <MessageUi.MessageContent><MessageUi.MessageHeader>Assistant · now</MessageUi.MessageHeader><BubbleUi.Bubble variant="muted"><BubbleUi.BubbleContent>I prepared the component inventory.</BubbleUi.BubbleContent></BubbleUi.Bubble><MessageUi.MessageFooter>Delivered</MessageUi.MessageFooter></MessageUi.MessageContent>
        </MessageUi.Message>
        <MessageUi.Message align="end">
          <MessageUi.MessageAvatar>DS</MessageUi.MessageAvatar>
          <MessageUi.MessageContent><BubbleUi.Bubble align="end"><BubbleUi.BubbleContent>Show me the responsive states too.</BubbleUi.BubbleContent></BubbleUi.Bubble><MessageUi.MessageFooter>Read</MessageUi.MessageFooter></MessageUi.MessageContent>
        </MessageUi.Message>
      </MessageUi.MessageGroup>
    </DemoSurface>
  )
}

function MessageScrollerDemo() {
  return (
    <DemoSurface>
      <MessageScrollerUi.MessageScrollerProvider>
        <MessageScrollerUi.MessageScroller className="h-72 rounded-xl border">
          <MessageScrollerUi.MessageScrollerViewport>
            <MessageScrollerUi.MessageScrollerContent className="p-4">
              {Array.from({ length: 10 }, (_, index) => <MessageScrollerUi.MessageScrollerItem key={index} scrollAnchor={index === 9}><BubbleUi.Bubble align={index % 2 ? 'end' : 'start'} variant={index % 2 ? 'default' : 'muted'}><BubbleUi.BubbleContent>Conversation message {index + 1}</BubbleUi.BubbleContent></BubbleUi.Bubble></MessageScrollerUi.MessageScrollerItem>)}
            </MessageScrollerUi.MessageScrollerContent>
          </MessageScrollerUi.MessageScrollerViewport>
          <MessageScrollerUi.MessageScrollerButton />
        </MessageScrollerUi.MessageScroller>
      </MessageScrollerUi.MessageScrollerProvider>
    </DemoSurface>
  )
}

export const uiDemos = {
  accordion: AccordionDemo,
  attachment: AttachmentDemo,
  alert: AlertDemo,
  'alert-dialog': AlertDialogDemo,
  'aspect-ratio': AspectRatioDemo,
  avatar: AvatarDemo,
  badge: BadgeDemo,
  bubble: BubbleDemo,
  breadcrumb: BreadcrumbDemo,
  button: ButtonDemo,
  'button-group': ButtonGroupDemo,
  calendar: CalendarDemo,
  card: CardDemo,
  carousel: CarouselDemo,
  chart: ChartDemo,
  checkbox: CheckboxDemo,
  collapsible: CollapsibleDemo,
  combobox: ComboboxDemo,
  command: CommandDemo,
  'context-menu': ContextMenuDemo,
  dialog: DialogDemo,
  direction: DirectionDemo,
  drawer: DrawerDemo,
  'dropdown-menu': DropdownMenuDemo,
  empty: EmptyDemo,
  field: FieldDemo,
  'hover-card': HoverCardDemo,
  input: InputDemo,
  'input-group': InputGroupDemo,
  'input-otp': InputOtpDemo,
  item: ItemDemo,
  kbd: KbdDemo,
  label: LabelDemo,
  menubar: MenubarDemo,
  marker: MarkerDemo,
  message: MessageDemo,
  'message-scroller': MessageScrollerDemo,
  'native-select': NativeSelectDemo,
  'navigation-menu': NavigationMenuDemo,
  pagination: PaginationDemo,
  popover: PopoverDemo,
  progress: ProgressDemo,
  'radio-group': RadioGroupDemo,
  resizable: ResizableDemo,
  'scroll-area': ScrollAreaDemo,
  select: SelectDemo,
  separator: SeparatorDemo,
  sheet: SheetDemo,
  sidebar: SidebarDemo,
  skeleton: SkeletonDemo,
  slider: SliderDemo,
  sonner: SonnerDemo,
  spinner: SpinnerDemo,
  switch: SwitchDemo,
  table: TableDemo,
  tabs: TabsDemo,
  textarea: TextareaDemo,
  toggle: ToggleDemo,
  'toggle-group': ToggleGroupDemo,
  tooltip: TooltipDemo,
} as const
