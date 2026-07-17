import { Redirect, useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { CatalogSection } from '@/components/catalog-section';
import { InlineGroup } from '@/components/inline-group';
import { PageHeader } from '@/components/page-header';
import { Screen } from '@/components/screen';
import { ScreenLoader } from '@/components/screen-states';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AspectRatio } from '@/components/ui/aspect-ratio';
import { Avatar, AvatarBadge, AvatarFallback, AvatarGroup, AvatarGroupCount } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { ButtonGroup, ButtonGroupSeparator, ButtonGroupText } from '@/components/ui/button-group';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/ui/carousel';
import { ChartBar, ChartContainer, ChartLegendContent, ChartTooltipContent } from '@/components/ui/chart';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Combobox,
  ComboboxChips,
  ComboboxChip,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from '@/components/ui/combobox';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command';
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { DirectionProvider, useDirection } from '@/components/ui/direction';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText } from '@/components/ui/input-group';
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from '@/components/ui/input-otp';
import { Input } from '@/components/ui/input';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { Label } from '@/components/ui/label';
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarTrigger,
} from '@/components/ui/menubar';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from '@/components/ui/navigation-menu';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Toaster, useToast } from '@/components/ui/sonner';
import { Typography } from '@/components/ui/typography';
import { TEST_IDS } from '@/constants/testIds';
import { AuthSessionErrorNotice, useAuth } from '@/features/auth';

export default function ComponentsScreen() {
  return (
    <Toaster>
      <ComponentsCatalog />
    </Toaster>
  );
}

function ComponentsCatalog() {
  const auth = useAuth();
  const router = useRouter();
  const themeDirection = useDirection();
  const toast = useToast();
  const [checked, setChecked] = useState(true);
  const [radio, setRadio] = useState('one');
  const [switchValue, setSwitchValue] = useState(true);
  const [otp, setOtp] = useState('123');
  const [slider, setSlider] = useState([42]);

  if (auth.isBootstrapping) {
    return <ScreenLoader />;
  }

  if (!auth.user) {
    return <Redirect href="/" />;
  }

  if (!auth.user.subscription.isActive) {
    return <Redirect href={'/paywall' as Href} />;
  }

  return (
    <Screen
      padded={false}
      scroll
      contentStyle={styles.content}
      scrollViewProps={{ showsVerticalScrollIndicator: false }}
      testID={TEST_IDS.components.catalog}>
      <PageHeader
        rootTestID={TEST_IDS.auth.dashboard}
        eyebrow="Mobile UI foundation"
        title="ShadCN native components"
        titleTestID={TEST_IDS.components.title}
        description={auth.user.email}
        descriptionTestID={TEST_IDS.auth.userEmail}
        actions={
          <>
            <Button
              testID={TEST_IDS.details.openButton}
              variant="outline"
              onPress={() => router.push('/details/components')}>
              Details
            </Button>
            <Button
              disabled={auth.isTransitioning}
              loading={auth.isTransitioning}
              testID={TEST_IDS.auth.logoutButton}
              variant="outline"
              onPress={() => void auth.logout().catch(() => undefined)}>
              Logout
            </Button>
          </>
        }
      />

      <AuthSessionErrorNotice />

      <CatalogSection title="Actions">
          <ButtonGroup>
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="destructive">Destructive</Button>
          </ButtonGroup>
          <ButtonGroup>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button loading>Loading</Button>
          </ButtonGroup>
          <ButtonGroup>
            <ButtonGroupText>Group</ButtonGroupText>
            <ButtonGroupSeparator orientation="vertical" />
            <Toggle defaultPressed>Toggle</Toggle>
            <ToggleGroup type="multiple" defaultValue={['b']}>
              <ToggleGroupItem value="a">A</ToggleGroupItem>
              <ToggleGroupItem value="b">B</ToggleGroupItem>
            </ToggleGroup>
          </ButtonGroup>
        </CatalogSection>

        <CatalogSection title="Forms">
          <FieldSet>
            <FieldLegend>Account</FieldLegend>
            <FieldGroup>
              <Field>
                <FieldLabel>Email</FieldLabel>
                <Input placeholder="name@example.com" autoCapitalize="none" />
                <FieldDescription>Shared input style.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel>Message</FieldLabel>
                <Textarea placeholder="Write a note" />
                <FieldError errors={[{ message: 'Example validation message' }]} />
              </Field>
            </FieldGroup>
          </FieldSet>
          <InputGroup>
            <InputGroupAddon>@</InputGroupAddon>
            <InputGroupInput placeholder="username" />
            <InputGroupButton size="sm">Save</InputGroupButton>
          </InputGroup>
          <InputGroupText>Input group helper text</InputGroupText>
          <InlineGroup>
            <Checkbox checked={checked} onCheckedChange={setChecked} />
            <Switch checked={switchValue} onCheckedChange={setSwitchValue} />
            <RadioGroup value={radio} onValueChange={setRadio}>
              <RadioGroupItem value="one" />
              <RadioGroupItem value="two" />
            </RadioGroup>
          </InlineGroup>
          <InputOTP value={otp} onValueChange={setOtp} maxLength={6} />
          <InputOTPGroup>
            <InputOTPSlot value={otp} index={0} />
            <InputOTPSlot value={otp} index={1} />
            <InputOTPSeparator />
            <InputOTPSlot value={otp} index={2} />
          </InputOTPGroup>
          <Slider value={slider} onValueChange={setSlider} min={0} max={100} step={5} />
          <NativeSelect defaultValue="ios">
            <NativeSelectOption value="ios">iOS</NativeSelectOption>
            <NativeSelectOption value="android">Android</NativeSelectOption>
          </NativeSelect>
          <Select defaultValue="native">
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="native">Native</SelectItem>
              <SelectItem value="web">Web</SelectItem>
            </SelectContent>
          </Select>
          <Label>Standalone label</Label>
        </CatalogSection>

        <CatalogSection title="Surfaces">
          <Alert>
            <AlertTitle>Alert title</AlertTitle>
            <AlertDescription>Neutral alert description.</AlertDescription>
          </Alert>
          <Alert variant="destructive">
            <AlertTitle>Destructive alert</AlertTitle>
            <AlertDescription>Error and warning state.</AlertDescription>
          </Alert>
          <Card>
            <CardHeader>
              <CardTitle>Card title</CardTitle>
              <CardDescription>Card description</CardDescription>
            </CardHeader>
            <CardContent>
              <Progress value={66} />
            </CardContent>
            <CardFooter>
              <Badge>Badge</Badge>
              <Badge variant="outline">Outline</Badge>
            </CardFooter>
          </Card>
          <Empty>
            <EmptyMedia>
              <Spinner />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>Empty state</EmptyTitle>
              <EmptyDescription>No records yet.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline">Create</Button>
            </EmptyContent>
          </Empty>
          <Skeleton style={styles.skeleton} />
          <KbdGroup>
            <Kbd>Cmd</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        </CatalogSection>

        <CatalogSection title="Data display">
          <AvatarGroup>
            <Avatar>
              <AvatarFallback>DS</AvatarFallback>
              <AvatarBadge />
            </Avatar>
            <Avatar>
              <AvatarFallback>UI</AvatarFallback>
            </Avatar>
            <AvatarGroupCount>3</AvatarGroupCount>
          </AvatarGroup>
          <ItemGroup>
            <Item>
              <ItemMedia>
                <Badge variant="secondary">A</Badge>
              </ItemMedia>
              <ItemContent>
                <ItemTitle>Item title</ItemTitle>
                <ItemDescription>Item description</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button size="sm" variant="outline">Open</Button>
              </ItemActions>
            </Item>
          </ItemGroup>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Button</TableCell>
                <TableCell>Ready</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <ChartContainer config={{ done: { label: 'Done', color: '#343434' } }}>
            <ChartBar value={72} />
            <ChartLegendContent />
            <ChartTooltipContent label="Progress" payload={[{ name: 'Done', value: '72%' }]} />
          </ChartContainer>
        </CatalogSection>

        <CatalogSection title="Disclosure">
          <Accordion type="single" defaultValue="a">
            <AccordionItem value="a">
              <AccordionTrigger>Accordion trigger</AccordionTrigger>
              <AccordionContent>Accordion content</AccordionContent>
            </AccordionItem>
          </Accordion>
          <Collapsible defaultOpen>
            <CollapsibleTrigger>Collapsible trigger</CollapsibleTrigger>
            <CollapsibleContent>Collapsible content</CollapsibleContent>
          </Collapsible>
          <Tabs defaultValue="one">
            <TabsList>
              <TabsTrigger value="one">One</TabsTrigger>
              <TabsTrigger value="two">Two</TabsTrigger>
            </TabsList>
            <TabsContent value="one">
              <Typography variant="bodySm">First tab content</Typography>
            </TabsContent>
            <TabsContent value="two">
              <Typography variant="bodySm">Second tab content</Typography>
            </TabsContent>
          </Tabs>
        </CatalogSection>

        <CatalogSection title="Overlays">
          <InlineGroup>
            <Dialog>
              <DialogTrigger fallback="Dialog" />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Dialog</DialogTitle>
                  <DialogDescription>Native modal dialog.</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose />
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <AlertDialog>
              <AlertDialogTrigger fallback="Alert" />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirm action</AlertDialogTitle>
                  <AlertDialogDescription>Alert dialog content.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel />
                  <AlertDialogAction>Continue</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Sheet>
              <SheetTrigger fallback="Sheet" />
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Sheet</SheetTitle>
                  <SheetDescription>Bottom sheet adaptation.</SheetDescription>
                </SheetHeader>
              </SheetContent>
            </Sheet>
            <Drawer>
              <DrawerTrigger fallback="Drawer" />
              <DrawerContent>
                <DrawerHeader>
                  <DrawerTitle>Drawer</DrawerTitle>
                  <DrawerDescription>Drawer content</DrawerDescription>
                </DrawerHeader>
                <DrawerFooter>
                  <Button variant="outline">Done</Button>
                </DrawerFooter>
              </DrawerContent>
            </Drawer>
            <Popover>
              <PopoverTrigger fallback="Popover" />
              <PopoverContent>
                <PopoverTitle>Popover</PopoverTitle>
                <PopoverDescription>Floating content.</PopoverDescription>
              </PopoverContent>
            </Popover>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger fallback="Tooltip" />
                <TooltipContent>
                  <Typography>Tooltip content</Typography>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <HoverCard>
              <HoverCardTrigger fallback="Hover card" />
              <HoverCardContent>
                <Typography>Touch-friendly hover card.</Typography>
              </HoverCardContent>
            </HoverCard>
          </InlineGroup>
        </CatalogSection>

        <CatalogSection title="Menus">
          <DropdownMenu>
            <DropdownMenuTrigger fallback="Dropdown" />
            <DropdownMenuContent>
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuItem>Profile<DropdownMenuShortcut>P</DropdownMenuShortcut></DropdownMenuItem>
              <DropdownMenuCheckboxItem checked>Enabled</DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Logout</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ContextMenu>
            <ContextMenuTrigger fallback="Context menu" />
            <ContextMenuContent>
              <ContextMenuLabel>Context</ContextMenuLabel>
              <ContextMenuItem>Copy</ContextMenuItem>
              <ContextMenuCheckboxItem checked>Visible</ContextMenuCheckboxItem>
              <ContextMenuSeparator />
              <ContextMenuItem>Delete</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
          <Menubar>
            <MenubarMenu>
              <MenubarTrigger fallback="File" />
              <MenubarContent>
                <MenubarItem>New</MenubarItem>
                <MenubarSeparator />
                <MenubarItem>Save</MenubarItem>
              </MenubarContent>
            </MenubarMenu>
          </Menubar>
          <Command>
            <CommandInput placeholder="Command search" />
            <CommandList>
              <CommandGroup heading="Suggestions">
                <CommandItem>Calendar<CommandShortcut>Cal</CommandShortcut></CommandItem>
                <CommandItem>Settings</CommandItem>
              </CommandGroup>
              <CommandEmpty>No results</CommandEmpty>
            </CommandList>
          </Command>
          <Combobox>
            <ComboboxTrigger fallback="Combobox" />
            <ComboboxContent>
              <ComboboxInput placeholder="Search option" />
              <ComboboxList>
                <ComboboxItem>First option</ComboboxItem>
                <ComboboxEmpty>No option</ComboboxEmpty>
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
          <ComboboxChips>
            <ComboboxChip>React Native</ComboboxChip>
            <ComboboxValue>Selected</ComboboxValue>
          </ComboboxChips>
        </CatalogSection>

        <CatalogSection title="Navigation and layout">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink>Home</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbEllipsis />
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Components</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <NavigationMenu>
            <NavigationMenuList>
              <NavigationMenuItem>
                <NavigationMenuTrigger>Overview</NavigationMenuTrigger>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuLink>Docs</NavigationMenuLink>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>
          <Pagination>
            <PaginationContent>
              <PaginationItem><PaginationPrevious /></PaginationItem>
              <PaginationItem><PaginationLink isActive>1</PaginationLink></PaginationItem>
              <PaginationItem><PaginationEllipsis /></PaginationItem>
              <PaginationItem><PaginationNext /></PaginationItem>
            </PaginationContent>
          </Pagination>
          <SidebarProvider>
            <SidebarTrigger />
            <Sidebar>
              <SidebarHeader>
                <Typography weight="700">Sidebar</Typography>
              </SidebarHeader>
              <SidebarContent>
                <SidebarGroup>
                  <SidebarGroupLabel>Menu</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      <SidebarMenuItem>
                        <SidebarMenuButton isActive>Components</SidebarMenuButton>
                      </SidebarMenuItem>
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              </SidebarContent>
            </Sidebar>
          </SidebarProvider>
          <ResizablePanelGroup style={styles.resizable}>
            <ResizablePanel defaultSize={2}>
              <Card><CardContent><Typography>Left</Typography></CardContent></Card>
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel>
              <Card><CardContent><Typography>Right</Typography></CardContent></Card>
            </ResizablePanel>
          </ResizablePanelGroup>
          <Carousel>
            <CarouselContent>
              <CarouselItem><Card><CardContent><Typography>Slide one</Typography></CardContent></Card></CarouselItem>
              <CarouselItem><Card><CardContent><Typography>Slide two</Typography></CardContent></Card></CarouselItem>
            </CarouselContent>
            <InlineGroup>
              <CarouselPrevious />
              <CarouselNext />
            </InlineGroup>
          </Carousel>
          <ScrollArea style={styles.scrollArea}>
            <Typography variant="bodySm">Scrollable area</Typography>
            <Separator />
            <Typography variant="bodySm">Direction: {themeDirection}</Typography>
          </ScrollArea>
          <DirectionProvider dir="rtl">
            <DirectionProbe />
          </DirectionProvider>
          <AspectRatio ratio={16 / 9} style={styles.aspect}>
            <Typography>Aspect ratio</Typography>
          </AspectRatio>
          <Button variant="outline" onPress={() => toast.toast({ title: 'Toast', description: 'Sonner native toast', type: 'success' })}>
            Show toast
          </Button>
      </CatalogSection>
    </Screen>
  );
}

function DirectionProbe() {
  const direction = useDirection();
  return <Typography variant="bodySm" muted>Nested direction: {direction}</Typography>;
}

const styles = StyleSheet.create({
  aspect: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    gap: 24,
    padding: 20,
    paddingBottom: 48,
  },
  resizable: {
    minHeight: 120,
  },
  scrollArea: {
    maxHeight: 96,
  },
  skeleton: {
    width: '65%',
  },
});
