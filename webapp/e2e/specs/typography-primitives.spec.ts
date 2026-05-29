import { expect, test } from '../helpers/test'

test('real primitive composition keeps Typography classes and owned data slots', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/typography-primitives.html')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')

  const buttonLink = page.getByTestId('button-link')
  await expect(buttonLink).toHaveAttribute('data-slot', 'button')
  await expect(buttonLink).toHaveAttribute('data-variant', 'default')
  await expect(buttonLink).toHaveAttribute('href', '/settings')
  await expect(buttonLink).toHaveClass(/text-background/)
  await expect(buttonLink).toHaveClass(/text-sm/)
  await expect(buttonLink).toHaveClass(/font-medium/)

  const asChildState = page.getByTestId('aschild-state')
  await expect(asChildState).toHaveAttribute('data-ref-ready', 'true')
  await buttonLink.evaluate((element) => {
    element.click()
  })
  await expect(asChildState).toHaveAttribute('data-child-clicks', '1')
  await expect(asChildState).toHaveAttribute('data-slot-clicks', '1')
  await expect(page).toHaveURL(/typography-primitives\.html$/)

  const dialogTitle = page.getByTestId('dialog-title')
  await expect(dialogTitle).toHaveAttribute('data-slot', 'dialog-title')
  await expect(dialogTitle).toHaveClass(/font-heading/)
  await expect(dialogTitle).toHaveClass(/text-base/)

  const dialogDescription = page.getByTestId('dialog-description')
  await expect(dialogDescription).toHaveAttribute(
    'data-slot',
    'dialog-description',
  )
  await expect(dialogDescription).toHaveClass(/text-sm/)
  await expect(dialogDescription).toHaveClass(/text-muted-foreground/)

  const dropdownItem = page.getByTestId('dropdown-item')
  await expect(dropdownItem).toHaveAttribute('data-slot', 'dropdown-menu-item')
  await expect(dropdownItem).toHaveClass(/text-sm/)
  await expect(dropdownItem).toHaveClass(/font-normal/)

  const selectItem = page.getByTestId('select-item')
  await expect(selectItem).toHaveAttribute('data-slot', 'select-item')
  await expect(selectItem).toHaveClass(/text-sm/)
  await expect(selectItem).toHaveClass(/font-normal/)

  const calendar = page.locator('[data-slot="calendar"]')
  await expect(calendar).toHaveCount(1)
  await expect(calendar).toHaveClass(/text-sm/)

  const dayButton = calendar.locator('button[data-day]').first()
  await expect(dayButton).toHaveAttribute('data-slot', 'button')
  await expect(dayButton).toHaveClass(/text-sm/)
  await expect(dayButton).toHaveClass(/font-normal/)

  const menubarTrigger = page.getByTestId('menubar-trigger')
  await expect(menubarTrigger).toHaveAttribute('data-slot', 'menubar-trigger')
  await expect(menubarTrigger).toHaveClass(/text-sm/)
  await expect(menubarTrigger).toHaveClass(/font-medium/)

  const menubarLabel = page.getByTestId('menubar-label')
  await expect(menubarLabel).toHaveAttribute('data-slot', 'menubar-label')
  await expect(menubarLabel).toHaveClass(/text-xs/)

  const menubarItem = page.getByTestId('menubar-item')
  await expect(menubarItem).toHaveAttribute('data-slot', 'menubar-item')
  await expect(menubarItem).toHaveClass(/text-sm/)

  const menubarShortcut = page.getByTestId('menubar-shortcut')
  await expect(menubarShortcut).toHaveAttribute(
    'data-slot',
    'menubar-shortcut',
  )
  await expect(menubarShortcut).toHaveClass(/text-xs/)

  const comboboxInput = page.getByTestId('combobox-input')
  await expect(comboboxInput).toHaveAttribute(
    'data-slot',
    'input-group-control',
  )
  await expect(comboboxInput).toHaveClass(/text-base/)

  const comboboxLabel = page.getByTestId('combobox-label')
  await expect(comboboxLabel).toHaveAttribute('data-slot', 'combobox-label')
  await expect(comboboxLabel).toHaveClass(/text-xs/)

  const comboboxItem = page.getByTestId('combobox-item')
  await expect(comboboxItem).toHaveAttribute('data-slot', 'combobox-item')
  await expect(comboboxItem).toHaveClass(/text-sm/)

  const fieldLegend = page.getByTestId('field-legend')
  await expect(fieldLegend).toHaveAttribute('data-slot', 'field-legend')
  await expect(fieldLegend).toHaveClass(/font-heading/)

  const fieldLabel = page.getByTestId('field-label')
  await expect(fieldLabel).toHaveAttribute('data-slot', 'field-label')
  await expect(fieldLabel).toHaveClass(/text-sm/)

  const fieldDescription = page.getByTestId('field-description')
  await expect(fieldDescription).toHaveAttribute(
    'data-slot',
    'field-description',
  )
  await expect(fieldDescription).toHaveClass(/text-muted-foreground/)

  const fieldError = page.getByTestId('field-error')
  await expect(fieldError).toHaveAttribute('data-slot', 'field-error')
  await expect(fieldError).toContainText('Name is required')
  await expect(fieldError.locator('[data-slot="field-error-message"]')).toHaveClass(
    /text-sm/,
  )

  const fieldTitle = page.getByTestId('field-title')
  await expect(fieldTitle).toHaveAttribute('data-slot', 'field-label')
  await expect(fieldTitle).toHaveClass(/font-medium/)

  const inputControl = page.getByTestId('input-control')
  await expect(inputControl).toHaveAttribute('data-slot', 'input')
  await expect(inputControl).toHaveClass(/text-base/)

  const textareaControl = page.getByTestId('textarea-control')
  await expect(textareaControl).toHaveAttribute('data-slot', 'textarea')
  await expect(textareaControl).toHaveClass(/text-base/)

  const nativeSelect = page.getByTestId('native-select')
  await expect(nativeSelect).toHaveAttribute('data-slot', 'native-select')
  await expect(nativeSelect).toHaveClass(/text-sm/)

  const table = page.getByTestId('data-table')
  await expect(table).toHaveAttribute('data-slot', 'table')
  await expect(table).toHaveClass(/text-sm/)

  const tableHead = page.getByTestId('table-head')
  await expect(tableHead).toHaveAttribute('data-slot', 'table-head')
  await expect(tableHead).toHaveClass(/font-medium/)

  const tableCaption = page.getByTestId('table-caption')
  await expect(tableCaption).toHaveAttribute('data-slot', 'table-caption')
  await expect(tableCaption).toHaveClass(/text-muted-foreground/)

  const tableCell = page.getByTestId('table-cell')
  await expect(tableCell).toHaveAttribute('data-slot', 'table-cell')

  const sidebarGroupLabel = page.getByTestId('sidebar-group-label')
  await expect(sidebarGroupLabel).toHaveAttribute(
    'data-slot',
    'sidebar-group-label',
  )
  await expect(sidebarGroupLabel).toHaveClass(/text-xs/)

  const sidebarGroupContent = page.getByTestId('sidebar-group-content')
  await expect(sidebarGroupContent).toHaveAttribute(
    'data-slot',
    'sidebar-group-content',
  )
  await expect(sidebarGroupContent).toHaveClass(/text-sm/)

  const sidebarMenuButton = page.getByTestId('sidebar-menu-button')
  await expect(sidebarMenuButton).toHaveAttribute(
    'data-slot',
    'sidebar-menu-button',
  )
  await expect(sidebarMenuButton).toHaveClass(/text-sm/)
  await expect(sidebarMenuButton).toHaveClass(/font-medium/)

  const sidebarMenuBadge = page.getByTestId('sidebar-menu-badge')
  await expect(sidebarMenuBadge).toHaveAttribute(
    'data-slot',
    'sidebar-menu-badge',
  )
  await expect(sidebarMenuBadge).toHaveClass(/text-xs/)

  await expect(page.locator('[data-slot="typography"]')).toHaveCount(0)
})
