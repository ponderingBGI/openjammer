import figma from '@figma/code-connect'
import { Field } from './Field'
import { Input } from '../Input/Input'

figma.connect(Field, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=8-30', {
  example: () => (<Field label="Label"><Input /></Field>),
})
