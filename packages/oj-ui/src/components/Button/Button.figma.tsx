import figma from '@figma/code-connect'
import { Button } from './Button'

figma.connect(Button, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=5-16', {
  example: () => (<Button>Button</Button>),
})
