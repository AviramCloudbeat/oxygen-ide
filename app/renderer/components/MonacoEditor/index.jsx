/*
 * Copyright (C) 2015-2018 CloudBeat Limited
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import * as monaco from 'monaco-editor';
import PropTypes from 'prop-types';
import React from 'react';
import path from 'path';

import oxygenIntellisense from './intellisense';
import * as helpers from './helpers';
import onDidChangeModelContent from './onDidChangeModelContent';
import onDidChangeCursorSelection from './onDidChangeCursorSelection';

function noop() {}

const EDITOR_CONTAINER_CLASS_NAME = 'monaco-editor-container';
const EDITOR_ACTION_FIND = 'actions.find';
const EDITOR_ACTION_REPLACE = 'editor.action.startFindReplaceAction'; 

const MONACO_DEFAULT_OPTIONS = {
  fontSize: '12pt',
  lineHeight: 19,
  fontFamily: 'Fira Code',
  fontLigatures: true,
  automaticLayout: true,
  minimap: {
		enabled: false,
	},
};

export default class MonacoEditor extends React.Component {
  state = {
    // editorClass holds an optional class name which will be added to editor's container DIV 
    editorClasses: [],
  };

  constructor(props) {
    super(props);
    this.editorContainer = undefined;
    this.__current_value = props.value;
  }

  componentDidMount() {
    this.initMonaco();
  }

  shouldComponentUpdate(nextProps, nextState) {    
    const propsStatus = this.determineUpdatedProps(nextProps);
    // return true if one or more properties has been updated
    const shouldUpdate = Object.keys(propsStatus).reduce( (sum, nextKey) => sum || propsStatus[nextKey], false);
    return shouldUpdate;
  }

  determineUpdatedProps(diffProps) {
    return {
      // prevent re-render when editor's value property is changed by onDidChangeModelContent event
      // otherwise, we will have an unneccessary call to editor.setValue (in componentDidUpdate) and duplicated render
      value: 
        this.editor ? 
          diffProps.value !== this.props.value &&
          diffProps.value !== this.editor.getValue() : false,
      lang: 
        diffProps.language !== this.props.language,
      activeLine:
        diffProps.activeLine !== this.props.activeLine,
      theme: 
        diffProps.theme !== this.props.theme,
      size:
          this.props.width !== diffProps.width || this.props.height !== diffProps.height,
      visible:
          this.props.visible != diffProps.visible,
    };
  }

  componentDidUpdate(prevProps) {
    if (this.props.value !== this.__current_value) {
      // Always refer to the latest value
      this.__current_value = this.props.value;
      // Consider the situation of rendering 1+ times before the editor mounted
      if (this.editor) {
        this.__prevent_trigger_change_event = true;
        this.editor.setValue(this.__current_value);
        this.__prevent_trigger_change_event = false;
      }
    }
    if (prevProps.language !== this.props.language) {
      monaco.editor.setModelLanguage(this.editor.getModel(), this.props.language);
    }
    if (prevProps.activeLine !== this.props.activeLine) {
      helpers.updateActiveLine(this.editor, this.props.activeLine);
    }
    if (prevProps.theme !== this.props.theme) {
      monaco.editor.setTheme(this.props.theme);
    }
    if (
      this.editor &&
      (this.props.width !== prevProps.width || this.props.height !== prevProps.height)
    ) {
      this.editor.layout();
    }
    else if (this.editor && this.props.visible == true && this.props.visible != prevProps.visible) {
      this.editor.layout();
    }
  }

  componentWillUnmount() {
    this.destroyMonaco();
  }

  editorWillMount() {
    const { editorWillMount } = this.props;
    editorWillMount(monaco);
  }

  editorDidMount(editor) {
    this.props.editorDidMount(editor, monaco);
    this.editor.layout();

    editor.onDidChangeModelContent((event) => {
      const value = editor.getValue();

      // Always refer to the latest value
      this.__current_value = value;

      // Only invoking when user input changed
      if (!this.__prevent_trigger_change_event) {
        this.props.onValueChange(value, event);
      }
    });
  }

  trigger(trigger) {
    // make sure we react to the external trigger only with the editor has a focus (e.g. cursor is blinking inside the editor)
    if (this.editor && trigger && this.editor.hasTextFocus()) {
      if (trigger === 'undo') {
        this.editor.getModel().undo();
      }
      else if (trigger === 'redo') {
        this.editor.getModel().redo();
      }
      else if (trigger === 'find') {
        this.editor.getAction(EDITOR_ACTION_FIND).run();
      }
      else if (trigger === 'replace') {
        this.editor.getAction(EDITOR_ACTION_REPLACE).run();
      }
    }
  }

  initMonaco() {
    const value = this.props.value !== null ? this.props.value : this.props.defaultValue;
    const { language, theme, options } = this.props;
    if (this.editorContainer) {
      // Before initializing monaco editor
      this.editorWillMount();
      this.editor = monaco.editor.create(this.editorContainer, {
        value,
        language,
        ...MONACO_DEFAULT_OPTIONS,
        ...options
      });
      oxygenIntellisense();
      if (theme) {
        monaco.editor.setTheme(theme);
      }
      this.hookToEditorEvents();
      // After initializing monaco editor
      this.editorDidMount(this.editor);
    }
  }

  destroyMonaco() {
    if (typeof this.editor !== 'undefined') {
      this.editor.dispose();
    }
  }

  /**
   * Watching click events
   */
  hookToEditorEvents = () => {
    const { activeFile } = this.props;
    const editor = this.editor;

    editor.onDidChangeModelContent(onDidChangeModelContent.bind(this));
    editor.onDidChangeCursorSelection(onDidChangeCursorSelection.bind(this));

    editor.onMouseDown((e) => {
      const { target: { element, position } } = e;

      if (element.className === 'line-numbers') {
        // select the entire line if the user clicks on line number panel
        const ln = position.lineNumber;
        editor.setSelection(new monaco.Selection(1, 2, 1, 2));
        editor.focus();
        // if user clicks on line-number panel, handle it as adding or removing a breakpoint at this line
        if (editor.getModel().getLineContent(ln).trim().length > 0) {
          let marker = helpers.getBreakpointMarker(editor, ln);
          if (!marker) {
            if (helpers.addBreakpointMarker(editor, ln)) {
              this.props.onBreakpointsUpdate(helpers.breakpointMarkersToLineNumbers(editor));
            }
          }
          else {
            if (helpers.removeBreakpointMarker(editor, ln)) {
              this.props.onBreakpointsUpdate(helpers.breakpointMarkersToLineNumbers(editor));
            }
          }
        } else {
          console.warn('Breakpoint cannot be set at the empty line.')
        }
      }
    });
  }

  assignRef = (component) => {
    this.editorContainer = component;
  };

  render() {
    const { width, height, visible } = this.props;
    const { editorClasses } = this.state;
    const fixedWidth = width.toString().indexOf('%') !== -1 ? width : `${width}px`;
    const fixedHeight = height.toString().indexOf('%') !== -1 ? height : `${height}px`;
    const style = {
      width: fixedWidth,
      height: fixedHeight,
      display: visible ? 'block' : 'none',
    };
    const classNames = [
      EDITOR_CONTAINER_CLASS_NAME,
      ...editorClasses,
    ].join(' ');
    return <div ref={this.assignRef} style={style} className={ classNames } />;
  }
}

MonacoEditor.propTypes = {
    visible: PropTypes.bool,
    width: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    height: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    value: PropTypes.string,
    defaultValue: PropTypes.string,
    language: PropTypes.string,
    theme: PropTypes.object,
    options: PropTypes.object,
    editorDidMount: PropTypes.func,
    editorWillMount: PropTypes.func,
    onValueChange: PropTypes.func,
    onSelectionChange: PropTypes.func,
    onBreakpointsUpdate: PropTypes.func,
};

MonacoEditor.defaultProps = {
    visible: true,
    width: '100%',
    height: '100%',
    value: null,
    defaultValue: '',
    language: 'javascript',
    theme: null,
    options: {},
    editorDidMount: noop,
    editorWillMount: noop,
    onValueChange: noop,
    onSelectionChange: noop,
    onBreakpointsUpdate: noop,
};
