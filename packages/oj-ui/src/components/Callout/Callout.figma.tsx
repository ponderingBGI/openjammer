import figma from '@figma/code-connect'
import { Callout } from './Callout'

figma.connect(Callout, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=9-48', {
  example: () => (<Callout>Heads up</Callout>),
})
