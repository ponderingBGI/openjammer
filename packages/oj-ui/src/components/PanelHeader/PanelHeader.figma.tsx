import figma from '@figma/code-connect'
import { PanelHeader } from './PanelHeader'

figma.connect(PanelHeader, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=20-2', {
  example: () => (<PanelHeader />),
})
