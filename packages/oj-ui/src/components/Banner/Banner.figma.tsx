import figma from '@figma/code-connect'
import { Banner } from './Banner'

figma.connect(Banner, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=21-41', {
  example: () => (<Banner />),
})
