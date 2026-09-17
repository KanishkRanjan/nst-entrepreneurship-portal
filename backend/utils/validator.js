import Role from '../models/role.js'

const validateName = name => {
  if (!name) {
    return 'Username is required'
  }
  if (name.length <= 1) {
    return 'Username length is too small, it should be greater than 2 character'
  }
  if (!/^[a-zA-Z]+([ '-][a-zA-Z]+)*$/.test(name)) {
    return 'Username is invalid, please use a valid name only containing character and no special character'
  }

  return ''
}

const validateEmail = email => {
  if (!email) {
    return 'Email is required'
  }
  if (!/^[a-zA-Z0-9._%+-]+@(adypu\.edu\.in|newtonschool\.co)$/i.test(email)) {
    return 'Email is invalid, please use an official ADYPU or Newton School email ID'
  }
  return ''
}

const validatePassword = password => {
  if (!password) {
    return 'Password is required'
  }
  if (password && password.length < 8) {
    return 'Password is too short, must of 8 or grater than 8'
  }
  return ''
}

const validatePosition = async position => {
  if (!position) {
    return 'Position is required'
  }
  const isValidPosition = await Role.findOne({
    name: position,
  })

  if (!isValidPosition) {
    return 'Position is invalid'
  }
  return ''
}

const validateAll = async ({ username, email, password, position }) => {
  const error = {}

  error.username = validateName(username)
  error.email = validateEmail(email)
  error.password = validatePassword(password)
  error.position = await validatePosition(position)

  return error
}

export {
  validateName,
  validateEmail,
  validatePassword,
  validatePosition,
  validateAll,
}
