import figma from '@figma/code-connect'
import { List, ListRow } from './ListRow'

figma.connect(List, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=11-2', {
  example: () => (<List />),
})

figma.connect(ListRow, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=11-24', {
  example: () => (<ListRow />),
})
