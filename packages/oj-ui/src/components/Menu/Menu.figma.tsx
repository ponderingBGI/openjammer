import figma from '@figma/code-connect'
import { Menu, MenuItem, MenuCategory, MenuSeparator } from './Menu'

figma.connect(Menu, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=22-69', {
  example: () => (<Menu />),
})

figma.connect(MenuItem, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=23-23', {
  example: () => (<MenuItem />),
})

figma.connect(MenuCategory, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=23-30', {
  example: () => (<MenuCategory />),
})

figma.connect(MenuSeparator, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=23-31', {
  example: () => (<MenuSeparator />),
})
