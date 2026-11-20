// Keep the large local password dictionary out of the initial page graph.
// Validation remains synchronous after this gate has loaded the original rules.
export function createAuthValidationLoader(importRules = () => import('./authForm.js')) {
  let rules = null;
  let pending = null;
  const requireRules = () => {
    if (!rules) throw new Error('Account validation is not ready. Close the form and try again.');
    return rules;
  };
  return {
    load() {
      if (rules) return Promise.resolve(rules);
      if (!pending) {
        pending = Promise.resolve().then(importRules).then(module => {
          if (typeof module?.validateAuthForm !== 'function' || typeof module?.validateNewPassword !== 'function') throw new Error('Account validation is unavailable.');
          rules = module;
          return rules;
        }).catch(error => { pending = null; throw error; });
      }
      return pending;
    },
    validateAuthForm: (...args) => requireRules().validateAuthForm(...args),
    validateNewPassword: (...args) => requireRules().validateNewPassword(...args),
  };
}

const validation = createAuthValidationLoader();
export const loadAuthValidation = validation.load;
export const validateAuthForm = validation.validateAuthForm;
export const validateNewPassword = validation.validateNewPassword;
